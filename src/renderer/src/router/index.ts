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
