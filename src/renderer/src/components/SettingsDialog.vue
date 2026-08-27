<template>
  <el-dialog v-model="settings.visible" title="模型配置" width="460px" append-to-body>
    <el-form label-position="top">
      <el-form-item label="Provider">
        <el-select v-model="settings.provider" style="width: 100%" @change="settings.refreshModels">
          <el-option label="Anthropic" value="anthropic" />
          <el-option label="OpenAI" value="openai" />
          <el-option label="Google" value="google" />
          <el-option label="MiniMax 国内站" value="minimax-cn" />
          <el-option label="MiniMax 国际站" value="minimax" />
          <el-option label="OpenRouter" value="openrouter" />
        </el-select>
      </el-form-item>
      <el-form-item label="API Key">
        <el-input v-model="settings.apiKey" type="password" show-password placeholder="sk-..." />
        <div class="hint">{{ keyHint }}</div>
      </el-form-item>
      <el-form-item label="模型">
        <div class="model-row">
          <el-select
            v-model="settings.modelId"
            filterable
            style="width: 100%"
            :loading="settings.loadingModels"
            :placeholder="settings.apiKey ? '选择一个模型' : '先填写 API Key'"
          >
            <el-option
              v-for="item in settings.models"
              :key="item.id"
              :label="item.name"
              :value="item.id"
            />
          </el-select>
          <el-button :loading="settings.loadingModels" @click="settings.refreshModels">刷新</el-button>
        </div>
        <div v-if="settings.apiKey && settings.models.length === 0 && !settings.loadingModels" class="hint">
          当前 Provider 没有可用模型。检查 Key 是否正确，或换一个 Provider。
        </div>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="settings.visible = false">取消</el-button>
      <el-button type="primary" @click="settings.save">保存</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useSettingsStore } from '@renderer/stores/settings'

const settings = useSettingsStore()

const keyHint = computed(() => {
  if (settings.provider === 'minimax-cn') {
    return 'minimax-cn 使用国内站 Key（环境变量 MINIMAX_CN_API_KEY）。401 invalid api key 表示 Key 无效或用了国际站 Key。'
  }
  if (settings.provider === 'minimax') {
    return 'minimax 使用国际站 Key（MINIMAX_API_KEY）。'
  }
  return '保存后会写入当前 Provider 的运行时 Key，不会发给错误的服务商。'
})
</script>

<style scoped>
.model-row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8px;
  width: 100%;
}

.hint {
  margin-top: 8px;
  font-size: 12px;
  color: var(--tm-muted);
  line-height: 1.5;
}
</style>
