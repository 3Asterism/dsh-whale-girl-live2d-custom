/** core/storage.js —— 由 tools/split-front.mjs 从 pet.js 拆出；模块职责见 assets/app/README.md */

const LS_KEY = 'dsh-live2d-pet:layout'

export function readLayout() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || '{}') || {}
  } catch (e) {
    return {}
  }
}

export function saveLayout(patch) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(Object.assign(readLayout(), patch)))
  } catch (e) {}
}
