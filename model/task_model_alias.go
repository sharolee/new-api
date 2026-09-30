package model

import (
	"fmt"
	"slices"
	"sync"
	"sync/atomic"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/pkg/jsplugin"
	"github.com/QuantumNous/new-api/relaykit/dto"
)

// TaskAliasTarget is one mapping-derived alias after cross-channel aggregation.
// Declared is empty when the same plugin resolves the alias to more than one
// declared tail (display-only; pin is disabled).
type TaskAliasTarget struct {
	Alias     string
	Declared  string
	PluginKey string
}

// TaskPassthroughTarget is the channel-scoped resolution of a passthrough
// model. UpstreamModel is what the vendor receives: the channel's
// model_mapping tail when one is configured, otherwise the claimed name. It is
// intentionally not a TaskAliasTarget because a passthrough tail is by
// definition absent from meta.models, which TaskAliasTarget.Declared requires.
type TaskPassthroughTarget struct {
	PluginKey     string
	UpstreamModel string
}

type taskAliasView struct {
	generation uint64
	expiresAt  time.Time
	byFold     map[string]TaskAliasTarget
	// passthroughByFold maps an undeclared model folded name to the plugin key of
	// the passthrough channel that claims it. Empty when no enabled passthrough
	// channel lists that model, which is what keeps unrelated undeclared models
	// out of plugin billing.
	passthroughByFold map[string]TaskPassthroughTarget
}

const taskAliasViewTTL = 60 * time.Second

var (
	taskAliasViewPtr   atomic.Pointer[taskAliasView]
	taskAliasRebuildMu sync.Mutex
)

// ResolveTaskModelAlias returns the mapping-derived alias target for name
// (exact or ASCII-folded). g is the caller's routing generation: a Number
// mismatch or TTL expiry rebuilds the view against that generation.
func ResolveTaskModelAlias(g *jsplugin.RoutingGeneration, name string) (TaskAliasTarget, bool) {
	if g == nil || name == "" {
		return TaskAliasTarget{}, false
	}
	view := loadFreshTaskAliasView(g)
	if view == nil {
		return TaskAliasTarget{}, false
	}
	target, ok := view.byFold[jsplugin.ASCIIFold(name)]
	return target, ok
}

// ResolveTaskModelPassthrough returns the plugin key of the passthrough channel
// claiming name. A claim requires an enabled channel that binds a plugin which
// opted into model passthrough and lists name in its own model list, which is
// the same pair of conditions the relay path uses to select that channel. A
// model claimed by more than one passthrough plugin resolves to not-found so
// billing never picks a plugin for an ambiguous request.
func ResolveTaskModelPassthrough(g *jsplugin.RoutingGeneration, name string) (string, bool) {
	target, ok := ResolveTaskPassthroughTarget(g, name)
	return target.PluginKey, ok
}

// ResolveTaskPassthroughTarget is ResolveTaskModelPassthrough plus the upstream
// model the claiming channel sends. The relay path needs that name to rewrite
// the request, and it is the mapping tail whenever the channel configured one.
func ResolveTaskPassthroughTarget(g *jsplugin.RoutingGeneration, name string) (TaskPassthroughTarget, bool) {
	if g == nil || name == "" {
		return TaskPassthroughTarget{}, false
	}
	view := loadFreshTaskAliasView(g)
	if view == nil {
		return TaskPassthroughTarget{}, false
	}
	target, ok := view.passthroughByFold[jsplugin.ASCIIFold(name)]
	return target, ok
}

// billingPluginsFor returns the plugins that may price name. A declared model
// keeps exactly the plugins that declare it, because only a declaring plugin
// can own a model on the relay path. An undeclared model resolves only through
// a passthrough channel that claims it, so an ordinary unclaimed model such as
// dall-e-3 keeps its built-in billing instead of inheriting a plugin's.
func billingPluginsFor(g *jsplugin.RoutingGeneration, name string) []*jsplugin.LoadedPlugin {
	if g == nil || name == "" {
		return nil
	}
	if declared := g.PluginsByModel(name); len(declared) > 0 {
		return declared
	}
	key, ok := ResolveTaskModelPassthrough(g, name)
	if !ok {
		return nil
	}
	plugin, ok := g.Get(key)
	if !ok {
		return nil
	}
	return []*jsplugin.LoadedPlugin{plugin}
}

func loadFreshTaskAliasView(g *jsplugin.RoutingGeneration) *taskAliasView {
	view := taskAliasViewPtr.Load()
	if taskAliasViewFresh(view, g.Number) {
		return view
	}
	taskAliasRebuildMu.Lock()
	defer taskAliasRebuildMu.Unlock()
	view = taskAliasViewPtr.Load()
	if taskAliasViewFresh(view, g.Number) {
		return view
	}
	rebuilt := buildTaskAliasView(g)
	taskAliasViewPtr.Store(rebuilt)
	return rebuilt
}

func taskAliasViewFresh(view *taskAliasView, generation uint64) bool {
	return view != nil && view.generation == generation && time.Now().Before(view.expiresAt)
}

func rebuildTaskAliasView() {
	taskAliasRebuildMu.Lock()
	defer taskAliasRebuildMu.Unlock()
	taskAliasViewPtr.Store(buildTaskAliasView(jsplugin.DefaultRegistry.Generation()))
}

type taskAliasDraft struct {
	spellings []string
	byPlugin  map[string]map[string]struct{}
}

func buildTaskAliasView(generation *jsplugin.RoutingGeneration) *taskAliasView {
	genNum := uint64(0)
	if generation != nil {
		genNum = generation.Number
	}
	view := &taskAliasView{
		generation:        genNum,
		expiresAt:         time.Now().Add(taskAliasViewTTL),
		byFold:            make(map[string]TaskAliasTarget),
		passthroughByFold: make(map[string]TaskPassthroughTarget),
	}
	if DB == nil {
		return view
	}

	var channels []Channel
	err := DB.Select("id", "type", "models", "model_mapping", "setting").
		Where("status = ?", common.ChannelStatusEnabled).
		Find(&channels).Error
	if err != nil {
		common.SysError(fmt.Sprintf("rebuild task alias view: %s", err.Error()))
		return view
	}

	// A passthrough channel claims every undeclared model it lists. Declared
	// models are skipped so a declaring plugin always keeps ownership, and a
	// model claimed by several passthrough plugins is dropped rather than
	// resolved to an arbitrary one. The claimed plugin also records the upstream
	// model its mapping tail names, because a passthrough tail is never declared.
	passthroughDrafts := make(map[string]map[string]map[string]struct{})
	for i := range channels {
		channel := &channels[i]
		if channel.Setting == nil || *channel.Setting == "" {
			continue
		}
		// Parse the setting read-only. Channel.GetSetting repairs a malformed
		// value by calling Save, which would persist this partially selected
		// snapshot and blank the channel's remaining columns.
		var setting dto.ChannelSettings
		if err := common.Unmarshal([]byte(*channel.Setting), &setting); err != nil {
			common.SysError(fmt.Sprintf("task passthrough view: channel %d setting: %s", channel.Id, err.Error()))
			continue
		}
		passthroughKeys := make([]string, 0, len(setting.TaskPluginBindings()))
		for _, key := range setting.TaskPluginBindings() {
			plugin, ok := generation.Get(key)
			if !ok || !plugin.Meta.ModelPassthrough {
				continue
			}
			passthroughKeys = append(passthroughKeys, key)
		}
		if len(passthroughKeys) == 0 {
			continue
		}
		// Read model_mapping read-only for the same reason as the setting above.
		var modelMap map[string]string
		if mappingJSON := channel.GetModelMapping(); mappingJSON != "" && mappingJSON != "{}" {
			if err := common.UnmarshalJsonStr(mappingJSON, &modelMap); err != nil {
				common.SysError(fmt.Sprintf("task passthrough view: channel %d model_mapping: %s", channel.Id, err.Error()))
				continue
			}
		}
		for _, key := range passthroughKeys {
			for _, modelName := range channel.GetModels() {
				if _, declared := generation.CanonicalModel(modelName); declared {
					continue
				}
				upstream := modelName
				if _, mapped := modelMap[modelName]; mapped {
					tail, cyclic := followChannelModelMapping(modelMap, modelName)
					if cyclic {
						common.SysError(fmt.Sprintf("task passthrough mapping cycle dropped: channel=%d key=%q", channel.Id, modelName))
						continue
					}
					upstream = tail
				}
				fold := jsplugin.ASCIIFold(modelName)
				claimed := passthroughDrafts[fold]
				if claimed == nil {
					claimed = make(map[string]map[string]struct{})
					passthroughDrafts[fold] = claimed
				}
				upstreams := claimed[key]
				if upstreams == nil {
					upstreams = make(map[string]struct{})
					claimed[key] = upstreams
				}
				upstreams[upstream] = struct{}{}
			}
		}
	}
	for fold, claimed := range passthroughDrafts {
		if len(claimed) != 1 {
			pluginKeys := make([]string, 0, len(claimed))
			for key := range claimed {
				pluginKeys = append(pluginKeys, key)
			}
			slices.Sort(pluginKeys)
			common.SysLog(fmt.Sprintf("task model passthrough %q dropped: claimed by multiple plugins %v", fold, pluginKeys))
			continue
		}
		for key, upstreams := range claimed {
			if len(upstreams) != 1 {
				common.SysLog(fmt.Sprintf("task model passthrough %q dropped: plugin %q maps it to multiple upstreams", fold, key))
				continue
			}
			for upstream := range upstreams {
				view.passthroughByFold[fold] = TaskPassthroughTarget{PluginKey: key, UpstreamModel: upstream}
			}
		}
	}

	drafts := make(map[string]*taskAliasDraft)
	for i := range channels {
		channel := &channels[i]
		mappingJSON := channel.GetModelMapping()
		if mappingJSON == "" || mappingJSON == "{}" {
			continue
		}
		modelMap := make(map[string]string)
		if err := common.UnmarshalJsonStr(mappingJSON, &modelMap); err != nil {
			common.SysError(fmt.Sprintf("task alias view: channel %d model_mapping: %s", channel.Id, err.Error()))
			continue
		}
		inModels := make(map[string]struct{})
		for _, modelName := range channel.GetModels() {
			inModels[modelName] = struct{}{}
		}
		for alias, mapped := range modelMap {
			if mapped == "" {
				continue
			}
			if _, exposed := inModels[alias]; !exposed {
				continue
			}
			if _, declared := generation.CanonicalModel(alias); declared {
				continue
			}
			tail, cyclic := followChannelModelMapping(modelMap, alias)
			if cyclic {
				common.SysError(fmt.Sprintf("task alias mapping cycle dropped: channel=%d key=%q", channel.Id, alias))
				continue
			}
			declared, ok := generation.CanonicalModel(tail)
			if !ok {
				continue
			}
			plugin, ok := generation.GetByModel(declared)
			if !ok {
				continue
			}
			fold := jsplugin.ASCIIFold(alias)
			draft := drafts[fold]
			if draft == nil {
				draft = &taskAliasDraft{byPlugin: make(map[string]map[string]struct{})}
				drafts[fold] = draft
			}
			draft.spellings = append(draft.spellings, alias)
			declareds := draft.byPlugin[plugin.Meta.Key]
			if declareds == nil {
				declareds = make(map[string]struct{})
				draft.byPlugin[plugin.Meta.Key] = declareds
			}
			declareds[declared] = struct{}{}
		}
	}

	for _, draft := range drafts {
		alias := draft.spellings[0]
		for _, spelling := range draft.spellings[1:] {
			if spelling < alias {
				alias = spelling
			}
		}
		if len(draft.byPlugin) != 1 {
			pluginKeys := make([]string, 0, len(draft.byPlugin))
			for key := range draft.byPlugin {
				pluginKeys = append(pluginKeys, key)
			}
			common.SysLog(fmt.Sprintf("task model alias %q dropped: maps to multiple plugins %v", alias, pluginKeys))
			continue
		}
		var pluginKey, declared string
		for key, declareds := range draft.byPlugin {
			pluginKey = key
			if len(declareds) == 1 {
				for name := range declareds {
					declared = name
				}
			}
		}
		view.byFold[jsplugin.ASCIIFold(alias)] = TaskAliasTarget{
			Alias:     alias,
			Declared:  declared,
			PluginKey: pluginKey,
		}
	}
	return view
}

// followChannelModelMapping walks one channel's mapping the same way
// ModelMappedHelper does: visited-set cycle detection, self-map stops at
// the current hop, a non-self cycle is reported to the caller.
func followChannelModelMapping(modelMap map[string]string, start string) (string, bool) {
	current := start
	visited := map[string]bool{current: true}
	for {
		mapped, exists := modelMap[current]
		if !exists || mapped == "" {
			return current, false
		}
		if visited[mapped] {
			if mapped == current {
				return current, false
			}
			return "", true
		}
		visited[mapped] = true
		current = mapped
	}
}
