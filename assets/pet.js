/**
 * dsh-live2d-pet —— 前端加载器（刻意保持极小）。
 *
 * 真正的前端代码是一组 ES 模块，放在 assets/app/，入口是 app/main.js，
 * 由宿主挂在 /dsh-pet/app/* 上（按 mtime 热读取：改完刷新页面就生效，不用重启 DSH）。
 * 目录结构与各模块职责见 assets/app/README.md。
 *
 * 为什么留这个文件：DSH 的注入点、standalone 页、自检页、桌面壳加载的都是
 * /dsh-pet/pet.js 这个固定地址；宿主会在本文件末尾追加 window.__DSH_PET_BOOT__（配置 + 版本），
 * 模块加载是异步的，所以 boot 一定先于模块代码就位。
 */
;(function () {
  'use strict'
  if (window.__DSH_PET_LOADED__) return
  window.__DSH_PET_LOADED__ = true
  import('/dsh-pet/app/main.js').catch(function (err) {
    window.__DSHPetError = String((err && err.stack) || err)
    console.error('[鲸鱼娘] 模块加载失败：', err)
  })
})()
