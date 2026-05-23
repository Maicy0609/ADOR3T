package com.adojas.android.plugins

import android.content.Context
import android.os.Environment
import com.adojas.android.bridge.AdojasPlugin
import org.json.JSONObject
import java.io.File

/**
 * 文件系统插件 —— 读写应用私有目录和外部存储。
 *
 * Actions:
 *   - read(path)              → 读取文本文件（优先私有目录，回退外部存储）
 *   - readBinary(path)        → 读取为 Base64 字符串
 *   - write(path, data)        → 写入文本文件
 *   - list(dir)               → 列出目录下的文件和文件夹
 *   - delete(path)            → 删除文件
 *   - exists(path)            → 检查文件是否存在
 *   - getExternalDirs()       → 返回所有可访问的外部存储根目录
 */
class FilePlugin(private val context: Context) : AdojasPlugin {

    override val name = "file"

    override fun execute(action: String, params: JSONObject): Any? {
        return when (action) {
            "read" -> readText(params)
            "readBinary" -> readBinary(params)
            "write" -> write(params)
            "list" -> list(params)
            "delete" -> delete(params)
            "exists" -> exists(params)
            "getExternalDirs" -> getExternalDirs()
            else -> throw IllegalArgumentException("unknown action: $action")
        }
    }

    // ====================================================================
    // 路径解析
    // ====================================================================

    /**
     * 按优先级解析路径：
     * 1. 绝对路径 → 直接使用
     * 2. 相对路径 → 拼接私有目录
     */
    private fun resolvePath(path: String): File {
        val clean = path.replace("../", "").replace("..\\", "")
        return if (clean.startsWith("/")) {
            // 绝对路径 /storage/emulated/0/...
            File(clean).normalize()
        } else {
            // 相对路径 → 应用私有目录
            context.filesDir.resolve(clean).normalize()
        }
    }

    // ====================================================================
    // Actions
    // ====================================================================

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

    /**
     * 返回可读的外部存储根目录列表，供前端扫描关卡文件。
     */
    private fun getExternalDirs(): List<String> {
        val dirs = mutableListOf<String>()

        // 外部共享存储
        if (Environment.getExternalStorageState() == Environment.MEDIA_MOUNTED) {
            dirs.add(Environment.getExternalStorageDirectory().absolutePath)
        }

        // 可能的 ADOFAI 数据目录
        val adofaiPaths = listOf(
            "ADOFAI", "A Dance of Fire and Ice",
            "Download", "Downloads",
            "adofai", "levels"
        )
        for (name in adofaiPaths) {
            val ext = Environment.getExternalStorageDirectory()
            val candidate = File(ext, name)
            if (candidate.isDirectory) {
                dirs.add(candidate.absolutePath)
            }
            // 也检查共享存储中的其他常见路径
            val dcim = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
            val d = File(dcim, name)
            if (d.isDirectory && !dirs.contains(d.absolutePath)) {
                dirs.add(d.absolutePath)
            }
        }

        return dirs.distinct()
    }
}
