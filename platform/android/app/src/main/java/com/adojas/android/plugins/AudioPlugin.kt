package com.adojas.android.plugins

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import android.media.SoundPool
import com.adojas.android.bridge.AdojasPlugin
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap

/**
 * 音频插件 —— 播放 hitsound、控制音量等。
 *
 * Actions:
 *   - playTone(frequency, duration, volume) → 合成并播放一个纯音
 *   - playPcm(samples, sampleRate, channels) → 播放 PCM 数据
 *   - setVolume(level) → 设置音量
 *   - stopAll() → 停止所有正在播放的音源
 */
class AudioPlugin(private val context: Context) : AdojasPlugin {

    override val name = "audio"

    private var masterVolume = 1.0f
    private val activeTracks = ConcurrentHashMap.newKeySet<AudioTrack>()

    override fun execute(action: String, params: JSONObject): Any? {
        return when (action) {
            "playTone" -> playTone(params)
            "playPcm" -> playPcm(params)
            "setVolume" -> setVolume(params)
            "stopAll" -> stopAll()
            else -> throw IllegalArgumentException("unknown action: $action")
        }
    }

    private fun playTone(params: JSONObject): Boolean {
        val frequency = params.getDouble("frequency").toFloat()
        val durationMs = params.optInt("duration", 200)
        val volume = (params.optDouble("volume", 1.0) * masterVolume).toFloat()

        val sampleRate = 44100
        val numSamples = (sampleRate * durationMs / 1000f).toInt()
        val samples = ShortArray(numSamples)

        for (i in 0 until numSamples) {
            val t = i.toFloat() / sampleRate
            val amp = (volume * Short.MAX_VALUE).toInt()
            val value = (amp * kotlin.math.sin(2.0 * Math.PI * frequency * t)).toInt()
            samples[i] = value.coerceIn(Short.MIN_VALUE.toInt(), Short.MAX_VALUE.toInt()).toShort()
        }

        playRawPcm(samples, sampleRate)
        return true
    }

    private fun playPcm(params: JSONObject): Boolean {
        val samplesArray = params.getJSONArray("samples")
        val sampleRate = params.optInt("sampleRate", 44100)
        val samples = ShortArray(samplesArray.length()) { i ->
            samplesArray.getDouble(i).toInt().coerceIn(
                Short.MIN_VALUE.toInt(), Short.MAX_VALUE.toInt()
            ).toShort()
        }
        playRawPcm(samples, sampleRate)
        return true
    }

    private fun playRawPcm(samples: ShortArray, sampleRate: Int) {
        val bufferSize = AudioTrack.getMinBufferSize(
            sampleRate,
            AudioFormat.CHANNEL_OUT_MONO,
            AudioFormat.ENCODING_PCM_16BIT
        )

        val track = AudioTrack.Builder()
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_GAME)
                    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                    .build()
            )
            .setAudioFormat(
                AudioFormat.Builder()
                    .setSampleRate(sampleRate)
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                    .build()
            )
            .setBufferSizeInBytes(bufferSize.coerceAtLeast(samples.size * 2))
            .setTransferMode(AudioTrack.MODE_STATIC)
            .build()

        activeTracks.add(track)
        track.write(samples, 0, samples.size)
        track.setVolume(masterVolume)
        track.play()
    }

    private fun setVolume(params: JSONObject): Boolean {
        masterVolume = params.optDouble("level", 1.0).toFloat().coerceIn(0f, 1f)
        return true
    }

    private fun stopAll(): Boolean {
        activeTracks.forEach { track ->
            try {
                track.stop()
                track.release()
            } catch (_: Exception) { }
        }
        activeTracks.clear()
        return true
    }
}
