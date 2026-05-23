package com.adojas.android.bridge

import org.json.JSONObject

/**
 * ADOJAS 原生能力插件接口。
 * 每个插件实现一系列 action，通过 IpcRouter 统一路由。
 */
interface AdojasPlugin {

    /** 插件名称 —— JS 侧通过此名称寻址 */
    val name: String

    /**
     * 执行一个同步调用。
     * @param action 操作名 (read / write / list / ...)
     * @param params JSON 参数
     * @return 任意可 JSON 序列化的结果
     */
    fun execute(action: String, params: JSONObject): Any?
}
