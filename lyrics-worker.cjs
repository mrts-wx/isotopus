const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { alignLyricsToTranscript } = require(path.join(process.env.ISOTOPUS_APP_PATH, 'lyrics.js'));

const parentPort = process.parentPort;

function report(id, phase, message) {
  parentPort?.postMessage({ type: 'progress', id, phase, message });
}

parentPort?.on('message', async event => {
  const payload = event.data;
  const { id, samples, lines, duration, cacheDir } = payload || {};
  let failureStage = 'model';
  try {
    if (!(samples instanceof Float32Array) || !Array.isArray(lines)) throw new Error('Dados de áudio ou letra inválidos.');
    report(id, 'model', 'Preparando o reconhecimento local em segundo plano…');
    await fs.mkdir(cacheDir, { recursive: true });

    const appPath = process.env.ISOTOPUS_APP_PATH;
    const transformersEntry = path.join(appPath, 'node_modules', '@huggingface', 'transformers', 'dist', 'transformers.node.mjs');
    const { pipeline, env } = await import(pathToFileURL(transformersEntry).href);
    env.cacheDir = cacheDir;

    const lastProgress = new Map();
    const transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-small', {
      dtype: 'q8',
      device: 'cpu',
      session_options: {
        intraOpNumThreads: 2,
        interOpNumThreads: 1,
        executionMode: 'sequential',
        enableCpuMemArena: false,
        enableMemPattern: false
      },
      progress_callback: progress => {
        if (progress?.status !== 'progress' || !Number.isFinite(progress.progress)) return;
        const file = String(progress.file || 'modelo');
        const percent = Math.max(0, Math.min(100, Math.round(progress.progress)));
        const now = Date.now(), previous = lastProgress.get(file);
        if (previous && (percent === previous.percent || (percent !== 100 && now - previous.at < 300))) return;
        lastProgress.set(file, { percent, at: now });
        report(id, 'model', `Baixando modelo ${file.split('/').pop()} · ${percent}%`);
      }
    });

    failureStage = 'recognition';
    report(id, 'audio', 'Analisando a faixa em segundo plano. Você pode continuar usando o Isótopus; isso pode levar alguns minutos…');
    const transcription = await transcriber(samples, {
      return_timestamps: 'word',
      chunk_length_s: 30,
      stride_length_s: 5,
      max_new_tokens: 192
    });
    const aligned = alignLyricsToTranscript(lines.map(text => ({ text })), transcription?.chunks, duration);
    if (aligned.ok) report(id, 'done', `Sincronização estimada · ${Math.round(aligned.coverage * 100)}% das palavras coincidiram`);
    parentPort.postMessage({ type: 'result', id, result: aligned });
  } catch (error) {
    console.error('Automatic lyric alignment failed in worker:', error);
    const detail = String(error?.message || error || 'erro desconhecido').replace(/\s+/g, ' ').slice(0, 180);
    const message = failureStage === 'model'
      ? `Não consegui preparar o modelo de reconhecimento. Isso não confirma que você está sem internet; verifique se o app consegue acessar huggingface.co e tente de novo. Detalhe: ${detail}`
      : `O modelo carregou, mas não conseguiu reconhecer esta gravação. Músicas com vocais, efeitos ou versões diferentes podem falhar. Detalhe: ${detail}`;
    parentPort?.postMessage({ type: 'result', id, result: { ok: false, error: message } });
  }
});
