import { boot } from 'quasar/wrappers'
import { createPinia } from 'pinia'

const pinia = createPinia()

export default boot(({ app }) => {
  app.use(pinia)
})

// 导出pinia实例，以便在非组件文件中使用
export { pinia }