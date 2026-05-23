package com.adojas.android.plugins

import android.content.Context
import com.adojas.android.bridge.AdojasPlugin
import org.json.JSONObject
import java.io.File

/**
 * 文件系统插件 —— 读写应用私有目录和 assets 中的文件。
 *
 * Actions:
 *   - read(path)       → 读取文本文件
 *   - readBinary(path) → 读取为 Base64 字符串
 *   - write(path, data) → 写入文本文件
 *   - list(dir)        → 列出目录下的文件和文件夹
 *   - delete(path)     → 删除文件
 *   - exists(path)     → 检查文件是否存在
 */
class FilePlugin(private val context: Context) : AdojasPlugin {

    override val name = "file"

    private val baseDir: File get() = context.filesDir

    override fun execute(action: String, params: JSONObject): Any? {
        return when (action) {
            "read" -> readText(params)
            "readBinary" -> readBinary(params)
            "write" -> write(params)
            "list" -> list(params)
            "delete" -> delete(params)
            "exists" -> exists(params)
            else -> throw IllegalArgumentException("unknown action: $action")
        }
    }

    private fun resolvePath(path: String): File {
        // 防止路径遍历攻击
        val clean = path.replace("../", "").replace("..\\", "")
        return baseDir.resolve(clean).normalize()
    }

    private fun readText(params: JSONObject): String {
        val file = resolvePath(params.getString("path"))
        return file.readText(Charsets.UTF_8)
    }

    private fun readBinary(params: JSONObject): String {
        val file = resolvePath(params.getString("path"))
        val bytes = file.readBytes()
        return android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)
    }

    private fun write(params: JSONObject): Boolean {
        val file = resolvePath(params.getString("path"))
        file.parentFile?.mkdirs()
        file.writeText(params.getString("data"), Charsets.UTF_8)
        return true
    }

    private fun list(params: JSONObject): List<Map<String, Any>> {
        val dir = resolvePath(params.optString("dir", ""))
        if (!dir.isDirectory) return emptyList()
        return dir.listFiles()?.map { f ->
            mapOf(
                "name" to f.name,
                "isDir" to f.isDirectory,
                "size" to f.length(),
                "lastModified" to f.lastModified()
            )
        } ?: emptyList()
    }

    private fun delete(params: JSONObject): Boolean {
        return resolvePath(params.getString("path")).delete()
    }

    private fun exists(params: JSONObject): Boolean {
        return resolvePath(params.getString("path")).exists()
    }
}
