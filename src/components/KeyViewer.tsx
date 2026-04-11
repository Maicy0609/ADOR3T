"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { useAppSettings } from "@/hooks/use-app-settings"

export interface KeyData {
  keyCode: string
  label: string
  isPressed: boolean
  count: number
}

export interface RainDrop {
  id: number
  startTime: number
  xSize: number
  finalHeight: number
  color: string
}

export interface KeyViewerProps {
  enabled: boolean
}

// 默认按键配置（与 JipperResourcePack 完全一致）
const DEFAULT_KEY_CODES: Record<string, string[]> = {
  key10: ["Tab", "Digit1", "Digit2", "KeyE", "KeyP", "Equal", "Backspace", "Backslash", "Space", "Comma"],
  key12: ["Tab", "Digit1", "Digit2", "KeyE", "KeyP", "Equal", "Backspace", "Backslash", "Space", "KeyC", "Comma", "Period"],
  key16: [
    "Tab",
    "Digit1",
    "Digit2",
    "KeyE",
    "KeyP",
    "Equal",
    "Backspace",
    "Backslash",
    "Space",
    "KeyC",
    "Comma",
    "Period",
    "CapsLock",
    "ShiftLeft",
    "Enter",
    "KeyH",
  ],
  key20: [
    "Tab",
    "Digit1",
    "Digit2",
    "KeyE",
    "KeyP",
    "Equal",
    "Backspace",
    "Backslash",
    "Space",
    "KeyC",
    "Comma",
    "Period",
    "CapsLock",
    "ShiftLeft",
    "Enter",
    "KeyH",
    "CapsLock",
    "KeyD",
    "ShiftRight",
    "Semicolon",
  ],
}

const DEFAULT_FOOT_KEY_CODES: Record<string, string[]> = {
  key2: ["F8", "F3"],
  key4: ["F8", "F3", "F7", "F2"],
  key6: ["F8", "F3", "F7", "F2", "F6", "F1"],
  key8: ["F8", "F4", "F7", "F3", "F6", "F2", "F5", "F1"],
  key16: [
    "F8",
    "F4",
    "F7",
    "F3",
    "F6",
    "F2",
    "F5",
    "F1",
    "Digit0",
    "Digit6",
    "Digit9",
    "Digit5",
    "Digit8",
    "Digit4",
    "Digit7",
    "Digit3",
  ],
}

// 后退序列（与 JipperResourcePack 完全一致）
const BACK_SEQUENCES: Record<string, number[]> = {
  key10: [8, 9],
  key12: [9, 8, 10, 11],
  key16: [12, 13, 9, 8, 10, 11, 14, 15],
  key20: [12, 13, 9, 8, 10, 11, 14, 15, 17, 16, 18, 19],
}

// 按键代码转显示文本（与 JipperResourcePack 完全一致）
function keyCodeToLabel(code: string): string {
  if (code.startsWith("Digit")) return code.slice(5)
  if (code.startsWith("Key")) return code.slice(3)
  if (code === "Space") return "␣"
  if (code === "Tab") return "⇥"
  if (code === "Enter") return "↵"
  if (code === "Backspace") return "Back"
  if (code === "CapsLock") return "⇪"
  if (code === "ShiftLeft") return "L⇧"
  if (code === "ShiftRight") return "R⇧"
  if (code === "ControlLeft") return "LCtrl"
  if (code === "ControlRight") return "RCtrl"
  if (code === "AltLeft") return "LAlt"
  if (code === "AltRight") return "RAlt"
  if (code === "ArrowUp") return "↑"
  if (code === "ArrowDown") return "↓"
  if (code === "ArrowLeft") return "←"
  if (code === "ArrowRight") return "→"
  if (code === "Equal") return "="
  if (code === "Minus") return "-"
  if (code === "Comma") return ","
  if (code === "Period") return "."
  if (code === "Slash") return "/"
  if (code === "Backslash") return "\\"
  if (code === "Semicolon") return ";"
  if (code === "Quote") return "'"
  if (code === "Backquote") return "`"
  if (code === "BracketLeft") return "["
  if (code === "BracketRight") return "]"
  if (code.startsWith("F")) return code
  return code
}

// 获取按键布局配置（与 JipperResourcePack 完全一致）
function getKeyLayout(style: string, footStyle: string, downLocation: boolean) {
  const remove = downLocation ? 200 : 0
  const keys: Array<{ index: number; x: number; y: number; width: number; row: number; rainParent?: number }> = []

  if (style === "key10") {
    for (let i = 0; i < 8; i++) keys.push({ index: i, x: 54 * i, y: 279 - remove, width: 50, row: 0 })
    keys.push({ index: 8, x: 81 + 54, y: 225 - remove, width: 77, row: 1 })
    keys.push({ index: 9, x: 81, y: 225 - remove, width: 50, row: 1 })
    // key10 只有 10 个键，索引 8 和 9 是后退键
  } else if (style === "key12") {
    for (let i = 0; i < 8; i++) keys.push({ index: i, x: 54 * i, y: 279 - remove, width: 50, row: 0 })
    const backSeq = BACK_SEQUENCES.key12
    for (let i = 0; i < backSeq.length; i++) {
      keys.push({ index: backSeq[i], x: 54 * i, y: 225 - remove, width: 50, row: 1, rainParent: i + 2 })
    }
  } else if (style === "key16") {
    for (let i = 0; i < 8; i++) keys.push({ index: i, x: 54 * i, y: 320 - remove, width: 50, row: 0 })
    const backSeq = BACK_SEQUENCES.key16
    for (let i = 0; i < backSeq.length; i++) {
      keys.push({ index: backSeq[i], x: 54 * i, y: 266 - remove, width: 50, row: 1, rainParent: i })
    }
  } else if (style === "key20") {
    for (let i = 0; i < 8; i++) keys.push({ index: i, x: 54 * i, y: 333 - remove, width: 50, row: 0 })
    const backSeq = BACK_SEQUENCES.key20.slice(0, 8)
    for (let i = 0; i < backSeq.length; i++) {
      keys.push({ index: backSeq[i], x: 54 * i, y: 279 - remove, width: 50, row: 1, rainParent: i })
    }
    // key20 的额外 4 个键
    keys.push({ index: 16, x: 81 + 54, y: 225 - remove, width: 77, row: 3 })
    keys.push({ index: 17, x: 81, y: 225 - remove, width: 50, row: 3 })
    keys.push({ index: 18, x: 54 * 4, y: 225 - remove, width: 77, row: 3 })
    keys.push({ index: 19, x: 54 * 4 + 81, y: 225 - remove, width: 50, row: 3 })
  }

  // 脚键
  const footKeys: Array<{ index: number; x: number; y: number; width: number }> = []
  if (footStyle !== "none") {
    const footCountMap: Record<string, number> = { key2: 2, key4: 4, key6: 6, key8: 8, key16: 16 }
    const count = footCountMap[footStyle] || 0
    const twoLine = count > 10
    const perLine = twoLine ? count / 2 : count

    for (let line = 0; line < (twoLine ? 2 : 1); line++) {
      let x = 432
      for (let i = 0; i < perLine; i++) {
        footKeys.push({ index: line * perLine + i, x, y: 15 + line * 30, width: 30 })
        x += 34
      }
    }
  }

  return { keys, footKeys }
}

export function KeyViewer({ enabled }: KeyViewerProps) {
  const { settings } = useAppSettings()
  const containerRef = useRef<HTMLDivElement>(null)
  const [pressedKeys, setPressedKeys] = useState<Set<string>>(new Set())
  const [keyCounts, setKeyCounts] = useState<number[]>(new Array(36).fill(0))
  const [totalKps, setTotalKps] = useState(0)
  const [kps, setKps] = useState(0)
  const pressTimesRef = useRef<number[]>([])
  const rainDropsRef = useRef<Map<number, RainDrop[]>>(new Map())
  const [rainUpdates, setRainUpdates] = useState(0) // 用于触发重渲染
  const animationFrameRef = useRef<number>()
  const keyBindRef = useRef<Record<string, string[]>>({})

  // 初始化按键绑定
  useEffect(() => {
    const style = settings.keyViewerStyle
    const footStyle = settings.footKeyViewerStyle
    const customCodes = settings.keyViewerKeyCodes || {}

    const handCodes = [...(DEFAULT_KEY_CODES[style] || [])]
    const footCodes = [...(DEFAULT_FOOT_KEY_CODES[footStyle] || [])]

    // 应用自定义按键
    Object.entries(customCodes).forEach(([key, codes]) => {
      const index = parseInt(key)
      if (!isNaN(index) && index < handCodes.length) {
        handCodes[index] = codes[0] || handCodes[index]
      }
    })

    const allCodes = [...handCodes, ...footCodes]
    const bindMap: Record<string, string[]> = {}
    allCodes.forEach((code, index) => {
      if (!bindMap[code]) bindMap[code] = []
      bindMap[code].push(String(index))
    })
    keyBindRef.current = bindMap
  }, [settings.keyViewerStyle, settings.footKeyViewerStyle, settings.keyViewerKeyCodes])

  // 键盘事件处理
  useEffect(() => {
    if (!enabled) return

    const handleKeyDown = (e: KeyboardEvent) => {
      const code = e.code
      const indices = keyBindRef.current[code]
      if (!indices) return

      // 防止重复触发
      if (pressedKeys.has(code)) return

      setPressedKeys((prev) => {
        const newSet = new Set(prev)
        newSet.add(code)
        return newSet
      })

      // 更新计数
      const now = Date.now()
      indices.forEach((indexStr) => {
        const index = parseInt(indexStr)
        setKeyCounts((prev) => {
          const newCounts = [...prev]
          newCounts[index] = (newCounts[index] || 0) + 1
          return newCounts
        })

        // 添加雨滴效果
        if (settings.keyViewerUseRain) {
          const keyId = index
          if (!rainDropsRef.current.has(keyId)) {
            rainDropsRef.current.set(keyId, [])
          }
          const color = settings.keyViewerStyle === "key20" && index >= 16 ? "#ff00ff" : index >= 8 ? "#ffffff" : "#8320da"
          rainDropsRef.current.get(keyId)?.push({
            id: now + index,
            startTime: now,
            xSize: index >= 16 ? 30 : index >= 8 ? 40 : 50,
            finalHeight: settings.keyViewerRainHeight,
            color,
          })
        }
      })

      // 记录按压时间用于 KPS 计算
      pressTimesRef.current.push(now)
      setTotalKps((prev) => prev + 1)
    }

    const handleKeyUp = (e: KeyboardEvent) => {
      const code = e.code
      setPressedKeys((prev) => {
        const newSet = new Set(prev)
        newSet.delete(code)
        return newSet
      })
    }

    window.addEventListener("keydown", handleKeyDown)
    window.addEventListener("keyup", handleKeyUp)

    return () => {
      window.removeEventListener("keydown", handleKeyDown)
      window.removeEventListener("keyup", handleKeyUp)
    }
  }, [enabled, settings.keyViewerStyle, settings.keyViewerUseRain, settings.keyViewerRainHeight])

  // KPS 计算和雨滴动画
  useEffect(() => {
    if (!enabled) return

    const updateLoop = () => {
      const now = Date.now()

      // 清理超过 1 秒的按压记录
      pressTimesRef.current = pressTimesRef.current.filter((t) => now - t <= 1000)
      setKps(pressTimesRef.current.length)

      // 触发雨滴更新
      setRainUpdates((prev) => prev + 1)

      animationFrameRef.current = requestAnimationFrame(updateLoop)
    }

    animationFrameRef.current = requestAnimationFrame(updateLoop)

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [enabled])

  // 清理雨滴
  useEffect(() => {
    if (!enabled) return

    const cleanupInterval = setInterval(() => {
      const now = Date.now()
      let changed = false

      rainDropsRef.current.forEach((drops, keyId) => {
        const validDrops = drops.filter((drop) => now - drop.startTime <= 2000)
        if (validDrops.length !== drops.length) {
          rainDropsRef.current.set(keyId, validDrops)
          changed = true
        }
      })

      if (changed) {
        setRainUpdates((prev) => prev + 1)
      }
    }, 100)

    return () => clearInterval(cleanupInterval)
  }, [enabled])

  if (!enabled) return null

  const { keys, footKeys } = getKeyLayout(settings.keyViewerStyle, settings.footKeyViewerStyle, settings.keyViewerDownLocation)
  const handCodes = DEFAULT_KEY_CODES[settings.keyViewerStyle] || []
  const footStyle = settings.footKeyViewerStyle
  const footCodes = DEFAULT_FOOT_KEY_CODES[footStyle] || []

  const containerStyle: React.CSSProperties = {
    position: "fixed",
    bottom: settings.keyViewerDownLocation ? "auto" : 20,
    top: settings.keyViewerDownLocation ? 20 : "auto",
    left: 20,
    zIndex: 9999,
    pointerEvents: "none",
    transform: `scale(${settings.keyViewerSize})`,
    transformOrigin: "top left",
    fontFamily: "Arial, sans-serif",
  }

  const renderRain = (keyId: number, baseX: number, baseY: number, rainParentOffset: number) => {
    const drops = rainDropsRef.current.get(keyId) || []
    const now = Date.now()

    return drops.map((drop) => {
      const elapsed = now - drop.startTime
      const y = (elapsed / 300) * settings.keyViewerRainSpeed
      const height = drop.finalHeight

      let renderY: number
      let renderHeight: number

      if (y > height) {
        const sizeY = drop.finalHeight - y + height
        if (sizeY < 0) return null
        renderY = height
        renderHeight = sizeY
      } else {
        renderY = y
        renderHeight = drop.finalHeight
      }

      return (
        <div
          key={drop.id}
          style={{
            position: "absolute",
            left: baseX,
            bottom: baseY + rainParentOffset + renderY,
            width: drop.xSize,
            height: renderHeight,
            backgroundColor: drop.color,
            opacity: 0.6,
            borderRadius: 2,
            transition: "none",
          }}
        />
      )
    })
  }

  return (
    <div ref={containerRef} style={containerStyle}>
      {/* 手键区域 */}
      <div style={{ position: "relative" }}>
        {keys.map((keyConfig) => {
          const code = handCodes[keyConfig.index]
          const isPressed = code ? pressedKeys.has(code) : false
          const count = keyCounts[keyConfig.index] || 0
          const label = keyCodeToLabel(code || "")

          return (
            <div
              key={keyConfig.index}
              style={{
                position: "absolute",
                left: keyConfig.x,
                bottom: keyConfig.y,
                width: keyConfig.width,
                height: 50,
                backgroundColor: isPressed ? "#ffffff" : "rgba(140, 60, 255, 0.2)",
                border: `2px solid ${isPressed ? "#ffffff" : "#8d3dff"}`,
                borderRadius: 4,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                color: isPressed ? "#000000" : "#ffffff",
                fontSize: 14,
                fontWeight: "bold",
                transition: "background-color 0.05s, border-color 0.05s, color 0.05s",
              }}
            >
              <span style={{ fontSize: 16 }}>{label}</span>
              <span style={{ fontSize: 12, marginTop: 2 }}>{count}</span>
              {/* 雨滴效果 */}
              {settings.keyViewerUseRain && renderRain(keyConfig.rainParent ?? keyConfig.index, 0, 0, -169)}
            </div>
          )
        })}

        {/* KPS 显示 */}
        <div
          style={{
            position: "absolute",
            left: 0,
            bottom: 220,
            width: 212,
            height: 50,
            backgroundColor: "rgba(140, 60, 255, 0.2)",
            border: "2px solid #8d3dff",
            borderRadius: 4,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            color: "#ffffff",
            fontSize: 14,
          }}
        >
          <span style={{ fontSize: 16 }}>KPS</span>
          <span style={{ fontSize: 18, fontWeight: "bold" }}>{kps}</span>
        </div>

        {/* Total 显示 */}
        <div
          style={{
            position: "absolute",
            left: 216,
            bottom: 220,
            width: 212,
            height: 50,
            backgroundColor: "rgba(140, 60, 255, 0.2)",
            border: "2px solid #8d3dff",
            borderRadius: 4,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            color: "#ffffff",
            fontSize: 14,
          }}
        >
          <span style={{ fontSize: 16 }}>Total</span>
          <span style={{ fontSize: 18, fontWeight: "bold" }}>{totalKps}</span>
        </div>
      </div>

      {/* 脚键区域 */}
      {footKeys.length > 0 && (
        <div style={{ position: "absolute", left: 432, bottom: 15 }}>
          {footKeys.map((keyConfig, i) => {
            const code = footCodes[i]
            const isPressed = code ? pressedKeys.has(code) : false
            const count = keyCounts[i + handCodes.length] || 0
            const label = keyCodeToLabel(code || "")

            return (
              <div
                key={`foot-${i}`}
                style={{
                  position: "absolute",
                  left: keyConfig.x - 432,
                  bottom: keyConfig.y,
                  width: 30,
                  height: 30,
                  backgroundColor: isPressed ? "#ffffff" : "rgba(140, 60, 255, 0.2)",
                  border: `2px solid ${isPressed ? "#ffffff" : "#8d3dff"}`,
                  borderRadius: 4,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: isPressed ? "#000000" : "#ffffff",
                  fontSize: 10,
                  fontWeight: "bold",
                }}
              >
                {label}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
