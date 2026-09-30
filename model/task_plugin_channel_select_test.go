package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/pkg/jsplugin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestTaskPluginChannelSelectionFiltersBothCachePaths(t *testing.T) {
	truncateTables(t)
	priority := int64(0)
	weight := uint(1)
	baseURL := "https://example.com"
	alphaSetting := `{"task_plugin_key":"alpha"}`
	betaSetting := `{"task_plugin_key":"beta"}`
	channels := []Channel{
		{Id: 900001, Type: constant.ChannelTypeTaskPlugin, Status: common.ChannelStatusEnabled, Name: "alpha", Models: "shared", Group: "default", Priority: &priority, Weight: &weight, BaseURL: &baseURL, Setting: &alphaSetting},
		{Id: 900002, Type: constant.ChannelTypeTaskPlugin, Status: common.ChannelStatusEnabled, Name: "beta", Models: "shared", Group: "default", Priority: &priority, Weight: &weight, BaseURL: &baseURL, Setting: &betaSetting},
		{Id: 900003, Type: constant.ChannelTypeOpenAI, Status: common.ChannelStatusEnabled, Name: "ordinary", Models: "ordinary", Group: "default", Priority: &priority, Weight: &weight},
		{Id: 900004, Type: constant.ChannelTypeKling, Status: common.ChannelStatusEnabled, Name: "legacy-alpha", Models: "legacy", Group: "default", Priority: &priority, Weight: &weight},
		{Id: 900005, Type: constant.ChannelTypeJimeng, Status: common.ChannelStatusEnabled, Name: "legacy-beta", Models: "legacy", Group: "default", Priority: &priority, Weight: &weight},
	}
	for i := range channels {
		require.NoError(t, channels[i].Insert())
	}

	selected, err := GetChannel("default", "shared", 0, identityFilters("alpha", nil))
	require.NoError(t, err)
	require.NotNil(t, selected)
	assert.Equal(t, "alpha", selected.Name)
	selected, err = GetChannel("default", "shared", 0, identityFilters("", nil))
	require.NoError(t, err)
	assert.Nil(t, selected)
	selected, err = GetChannel("default", "ordinary", 0, identityFilters("", nil))
	require.NoError(t, err)
	require.NotNil(t, selected)
	assert.Equal(t, "ordinary", selected.Name)
	selected, err = GetChannel("default", "legacy", 0, identityFilters("legacy-alpha", []int{constant.ChannelTypeKling}))
	require.NoError(t, err)
	require.NotNil(t, selected)
	assert.Equal(t, "legacy-alpha", selected.Name)
	selected, err = GetChannel("default", "legacy", 0, identityFilters("legacy-alpha", []int{constant.ChannelTypeKling, constant.ChannelTypeJimeng}))
	require.NoError(t, err)
	require.NotNil(t, selected)
	assert.Contains(t, []string{"legacy-alpha", "legacy-beta"}, selected.Name)
}

func identityFilters(key string, channelTypes []int) []dto.ChannelFilter {
	return []dto.ChannelFilter{{
		Kind:                   dto.FilterTaskPluginIdentity,
		TaskPluginKey:          key,
		TaskPluginChannelTypes: channelTypes,
	}}
}

func TestSharedPluginKeysFilterBothChannelSources(t *testing.T) {
	truncateTables(t)
	originalMemoryCache := common.MemoryCacheEnabled
	common.MemoryCacheEnabled = true
	t.Cleanup(func() { common.MemoryCacheEnabled = originalMemoryCache; InitChannelCache() })
	filters := []dto.ChannelFilter{{Kind: dto.FilterTaskPluginIdentity, TaskPluginKey: "alpha", TaskPluginKeys: []string{"alpha", "beta"}}}
	var abilities []Ability
	for index, key := range []string{"alpha", "beta", "unrelated"} {
		setting := `{"task_plugin_key":"` + key + `"}`
		channel := Channel{Id: 910001 + index, Type: constant.ChannelTypeTaskPlugin, Status: common.ChannelStatusEnabled, Name: key, Models: "shared", Group: "default", Setting: &setting}
		require.NoError(t, channel.Insert())
		abilities = append(abilities, Ability{ChannelId: channel.Id, Model: "shared", Group: "default", Enabled: true})
		matches, _ := ChannelSatisfiesFilters(&channel, "shared", filters)
		assert.Equal(t, index < 2, matches)
	}
	assert.Equal(t, abilities[:2], filterAbilitiesByConstraints(abilities, "shared", filters))
	InitChannelCache()
	channelSyncLock.RLock()
	kept, emptied := filterCandidateIDs([]int{910001, 910002, 910003}, "shared", filters)
	channelSyncLock.RUnlock()
	assert.Equal(t, []int{910001, 910002}, kept)
	assert.Empty(t, emptied)
}

func TestNewAPIChannelServesExtendedTaskPlugins(t *testing.T) {
	truncateTables(t)
	priority := int64(0)
	weight := uint(1)
	baseURL := "https://gateway.example"
	extended := `{"task_extend_plugin_keys":["alpha","gamma"]}`
	single := `{"task_plugin_key":"delta"}`
	channels := []Channel{
		{Id: 920001, Type: constant.ChannelTypeNewAPI, Status: common.ChannelStatusEnabled, Name: "gateway", Models: "shared,chat", Group: "default", Priority: &priority, Weight: &weight, BaseURL: &baseURL, Setting: &extended},
		{Id: 920002, Type: constant.ChannelTypeNewAPI, Status: common.ChannelStatusEnabled, Name: "gateway-single", Models: "shared", Group: "default", Priority: &priority, Weight: &weight, BaseURL: &baseURL, Setting: &single},
	}
	for i := range channels {
		require.NoError(t, channels[i].Insert())
	}

	selected, err := GetChannel("default", "shared", 0, identityFilters("alpha", nil))
	require.NoError(t, err)
	require.NotNil(t, selected)
	assert.Equal(t, "gateway", selected.Name)
	selected, err = GetChannel("default", "shared", 0, identityFilters("delta", nil))
	require.NoError(t, err)
	require.NotNil(t, selected)
	assert.Equal(t, "gateway-single", selected.Name, "a single task_plugin_key still binds a New API channel")
	selected, err = GetChannel("default", "shared", 0, identityFilters("beta", nil))
	require.NoError(t, err)
	assert.Nil(t, selected, "unbound plugins never reach the gateway channel")
	shared := []dto.ChannelFilter{{Kind: dto.FilterTaskPluginIdentity, TaskPluginKey: "beta", TaskPluginKeys: []string{"beta", "gamma"}}}
	selected, err = GetChannel("default", "shared", 0, shared)
	require.NoError(t, err)
	require.NotNil(t, selected)
	assert.Equal(t, "gateway", selected.Name, "a bound shared-model candidate admits the channel")
	selected, err = GetChannel("default", "chat", 0, identityFilters("", nil))
	require.NoError(t, err)
	require.NotNil(t, selected)
	assert.Equal(t, "gateway", selected.Name, "requests without a pinned plugin keep using the gateway")
}

func TestPassthroughChannelServesOnlyPinnedDeclaredModels(t *testing.T) {
	truncateTables(t)
	priority := int64(0)
	weight := uint(1)
	baseURL := "https://example.com"
	passthroughSetting := `{"task_plugin_key":"modelscope"}`
	channels := []Channel{
		{Id: 930001, Type: constant.ChannelTypeTaskPlugin, Status: common.ChannelStatusEnabled, Name: "passthrough", Models: "qwen-image-2.1", Group: "default", Priority: &priority, Weight: &weight, BaseURL: &baseURL, Setting: &passthroughSetting},
	}
	for i := range channels {
		require.NoError(t, channels[i].Insert())
	}
	InitChannelCache()

	selected, err := GetChannel("default", "qwen-image-2.1", 0, identityFilters("modelscope", nil))
	require.NoError(t, err)
	require.NotNil(t, selected, "an enabled passthrough channel serves an arbitrary name it lists in its models")
	assert.Equal(t, "passthrough", selected.Name)

	selected, err = GetChannel("default", "never-declared", 0, identityFilters("modelscope", nil))
	require.NoError(t, err)
	assert.Nil(t, selected, "modelPassthrough must not let a plugin serve names outside its channel models list")

	// An unpinned request does not carry a nil filter: Distribute always appends
	// an identity filter, with an empty key when no plugin is pinned. That empty
	// key excludes every task-plugin channel, so a name the plugin does not
	// declare can never reach this channel through the standard relay. This is
	// the anti-hijack guard that keeps passthrough from capturing ordinary
	// traffic: only the relay path's own pin, derived from a channel-scoped
	// claim, may set the key that admits a passthrough channel.
	selected, err = GetChannel("default", "qwen-image-2.1", 0, identityFilters("", nil))
	require.NoError(t, err)
	assert.Nil(t, selected, "an unpinned request must not reach a passthrough channel")
}

func TestPassthroughClaimCarriesChannelMappingTailAsUpstreamModel(t *testing.T) {
	truncateTables(t)
	const key = "passthrough-mapping-probe"
	_, err := jsplugin.DefaultRegistry.Register(
		pricingPassthroughPluginSource(
			key,
			"declared-model",
			"1.0.0",
			`{image_count: {type: "number", unit: "count", description: "Image generation unit price"}}`,
		),
		jsplugin.Options{},
	)
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, jsplugin.DefaultRegistry.Unregister(key)) })

	// A second plugin that declares z-image-turbo stands in for a built-in owner
	// such as alibaba. The declaration, not the passthrough flag, is what gives
	// that plugin the name, and the declaration wins over a passthrough claim.
	const declaringKey = "declaring-probe"
	_, err = jsplugin.DefaultRegistry.Register(
		pricingPassthroughPluginSource(
			declaringKey,
			"z-image-turbo",
			"1.0.0",
			`{image_count: {type: "number", unit: "count", description: "Image generation unit price"}}`,
		),
		jsplugin.Options{},
	)
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, jsplugin.DefaultRegistry.Unregister(declaringKey)) })

	priority := int64(0)
	weight := uint(1)
	baseURL := "https://example.com"
	setting := `{"task_plugin_key":"` + key + `"}`
	mapping := `{"qwen-image-2.1":"Qwen/Qwen-Image-2.1","kling-image-v2":"Kling/Kling-Image-V2","z-image-turbo":"Tongyi-MAI/Z-Image-Turbo","ambiguous-model":"First/Upstream"}`
	channel := Channel{
		Id: 940001, Type: constant.ChannelTypeTaskPlugin, Status: common.ChannelStatusEnabled,
		Name: "passthrough", Models: "qwen-image-2.1,kling-image-v2,z-image-turbo,unmapped-model,ambiguous-model",
		Group: "default", Priority: &priority, Weight: &weight, BaseURL: &baseURL,
		Setting: &setting, ModelMapping: &mapping,
	}
	require.NoError(t, channel.Insert())
	rebuildTaskAliasView()
	generation := jsplugin.DefaultRegistry.Generation()

	target, ok := ResolveTaskPassthroughTarget(generation, "qwen-image-2.1")
	require.True(t, ok)
	assert.Equal(t, key, target.PluginKey)
	assert.Equal(t, "Qwen/Qwen-Image-2.1", target.UpstreamModel,
		"the vendor receives the mapping tail, which is absent from meta.models")

	target, ok = ResolveTaskPassthroughTarget(generation, "kling-image-v2")
	require.True(t, ok)
	assert.Equal(t, "Kling/Kling-Image-V2", target.UpstreamModel)

	_, ok = ResolveTaskPassthroughTarget(generation, "z-image-turbo")
	assert.False(t, ok,
		"a name another plugin declares is owned by that plugin, so this channel's mapping tail is never consulted")

	target, ok = ResolveTaskPassthroughTarget(generation, "unmapped-model")
	require.True(t, ok, "a claimed name with no mapping is still claimed")
	assert.Equal(t, "unmapped-model", target.UpstreamModel,
		"an unmapped claimed name reaches the vendor unchanged")

	_, ok = ResolveTaskPassthroughTarget(generation, "declared-model")
	assert.False(t, ok, "a model the plugin declares is never a passthrough claim")

	_, ok = ResolveTaskPassthroughTarget(generation, "never-listed")
	assert.False(t, ok, "a name outside the channel models list is never claimed")

	// A second channel claiming the same name for a different upstream makes the
	// claim ambiguous, so it is dropped rather than resolved to one of them.
	secondMapping := `{"ambiguous-model":"Second/Upstream"}`
	second := Channel{
		Id: 940002, Type: constant.ChannelTypeTaskPlugin, Status: common.ChannelStatusEnabled,
		Name: "passthrough-2", Models: "ambiguous-model", Group: "default",
		Priority: &priority, Weight: &weight, BaseURL: &baseURL,
		Setting: &setting, ModelMapping: &secondMapping,
	}
	require.NoError(t, second.Insert())
	rebuildTaskAliasView()
	_, ok = ResolveTaskPassthroughTarget(generation, "ambiguous-model")
	assert.False(t, ok, "one plugin resolving a name to two upstream models is ambiguous")
}
