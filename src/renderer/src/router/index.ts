/**
 * Hash 路由。安装包用 file:// 加载，不能用浏览器 history 模式。
 */
import { createRouter, createWebHashHistory } from 'vue-router'
import WorkspaceView from '@renderer/views/WorkspaceView.vue'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      name: 'workspace',
      component: WorkspaceView
    }
  ]
})

export default router
