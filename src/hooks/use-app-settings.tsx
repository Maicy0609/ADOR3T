"use client"

import { useState, useEffect } from "react"

export type RendererType = "webgl" | "webgpu"
export type RenderMethodType = "sync" | "async"
export type LoadMethodType = "sync" | "async" | "worker"
export type TargetFramerateType = "auto" | "30" | "60" | "120" | "144" | "165" | "240" | "unlimited"
export type KeyViewerStyleType = "key10" | "key12" | "key16" | "key20"
export type FootKeyViewerStyleType = "none" | "key2" | "key4" | "key6" | "key8" | "key16"

interface AppSettings {
  renderer: RendererType
  renderMethod: RenderMethodType
  showTrail: boolean
  useWorker: boolean
  targetFramerate: TargetFramerateType
  loadMethod: LoadMethodType
  hitsoundEnabled: boolean
  showStats: boolean // 是否使用 stats.js 面板
  keyViewerEnabled: boolean // KeyViewer 开关
  keyViewerStyle: KeyViewerStyleType // KeyViewer 样式
  footKeyViewerStyle: FootKeyViewerStyleType // 脚键 KeyViewer 样式
  keyViewerSize: number // KeyViewer 大小
  keyViewerDownLocation: boolean // KeyViewer 位置（上方/下方）
  keyViewerUseRain: boolean // 是否使用雨滴效果
  keyViewerRainSpeed: number // 雨滴速度
  keyViewerRainHeight: number // 雨滴高度
  keyViewerKeyCodes: Record<string, string[]> // 自定义按键绑定
}

const DEFAULT_SETTINGS: AppSettings = {
  renderer: "webgl", // Default to WebGL for compatibility
  renderMethod: "sync", // Default to synchronous rendering
  showTrail: false, // Default to disabled
  useWorker: true, // Default to enabled for better performance
  targetFramerate: "auto", // Default to auto (monitor refresh rate)
  loadMethod: "async", // Default to async loading
  hitsoundEnabled: true, // Default to enabled
  showStats: false, // Default to using default FPS panel
  keyViewerEnabled: true, // Default to enabled
  keyViewerStyle: "key16", // Default to 16-key layout
  footKeyViewerStyle: "key4", // Default to 4-foot-key layout
  keyViewerSize: 1, // Default size
  keyViewerDownLocation: false, // Default to top location
  keyViewerUseRain: true, // Default to enabled
  keyViewerRainSpeed: 100, // Default speed
  keyViewerRainHeight: 200, // Default height
  keyViewerKeyCodes: {}, // Default empty custom key codes
}

export function useAppSettings() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    const storedSettings = localStorage.getItem("app-settings")
    if (storedSettings) {
      try {
        setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(storedSettings) })
      } catch (e) {
        console.error("Failed to parse app settings", e)
      }
    }
  }, [])

  const updateSettings = (newSettings: Partial<AppSettings>) => {
    setSettings((prev) => {
      const updated = { ...prev, ...newSettings }
      localStorage.setItem("app-settings", JSON.stringify(updated))
      return updated
    })
  }

  return {
    settings,
    updateSettings,
    mounted,
  }
}
