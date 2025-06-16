const express = require('express');
const sdk = require('microsoft-cognitiveservices-speech-sdk');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
require('dotenv').config();

// Dynamically set FFmpeg path
try {
  const ffmpegPath = require('ffmpeg-static');
  ffmpeg.setFfmpegPath(ffmpegPath);
  console.log('FFmpeg path set to:', ffmpegPath);
} catch (error) {
  console.error('Failed to set FFmpeg path:', error.message);
}

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Multer for handling file uploads
const upload = multer({ dest: 'uploads/' });

// Serve audio files
app.use('/audio', express.static(path.join(__dirname, 'audio'), {
  setHeaders: (res) => {
    res.set('Content-Type', 'audio/mpeg');
  }
}));

// Ensure directories exist
const audioDir = path.join(__dirname, 'audio');
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir);
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

// Voice mapping for synthesis
const voiceMap = {
  'en': 'en-US-AriaNeural',
  'hi': 'hi-IN-MadhurNeural',
  'pa': 'pa-IN-AnmolNeural',
  'kn': 'kn-IN-GaganNeural',
  'te': 'te-IN-MohanNeural',
  'ta': 'ta-IN-ValluvarNeural',
  'ml': 'ml-IN-MidhunNeural'
};

// Language mapping for transcription
const languageMap = {
  en: 'en-US',
  hi: 'hi-IN',
  pa: 'pa-IN',
  kn: 'kn-IN',
  te: 'te-IN',
  ta: 'ta-IN',
  ml: 'ml-IN'
};

// Convert WebM to WAV
async function convertToWav(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .toFormat('wav')
      .audioChannels(1)
      .audioFrequency(16000)
      .on('error', (err) => {
        console.error('FFmpeg conversion error:', err.message);
        reject(new Error(`FFmpeg error: ${err.message}`));
      })
      .on('end', () => {
        console.log('FFmpeg conversion completed');
        resolve();
      })
      .save(outputPath);
  });
}

app.post('/synthesize', async (req, res) => {
  const { text, language } = req.body;
  console.log('Synthesize request received:', { text, language, origin: req.get('Origin') });

  if (!text || !language) {
    console.error('Synthesize: Missing text or language');
    return res.status(400).json({ error: 'Text and language are required' });
  }

  const voice = voiceMap[language] || voiceMap['en'];
  const audioFile = path.join(audioDir, `audio-${Date.now()}.mp3`);

  try {
    const speechConfig = sdk.SpeechConfig.fromSubscription(process.env.SPEECH_KEY, process.env.SPEECH_REGION);
    speechConfig.speechSynthesisVoiceName = voice;
    speechConfig.speechSynthesisOutputFormat = sdk.SpeechSynthesisOutputFormat.Audio16Khz32KBitRateMonoMp3;

    const audioConfig = sdk.AudioConfig.fromAudioFileOutput(audioFile);
    const synthesizer = new sdk.SpeechSynthesizer(speechConfig, audioConfig);

    await new Promise((resolve, reject) => {
      synthesizer.speakTextAsync(
        text,
        (result) => {
          synthesizer.close();
          if (result.reason === sdk.ResultReason.SynthesizingAudioCompleted) {
            console.log(`Synthesize: Audio generated at ${audioFile}`);
            resolve();
          } else {
            reject(new Error(result.errorDetails));
          }
        },
        (error) => {
          synthesizer.close();
          reject(error);
        }
      );
    });

    const audioUrl = `http://localhost:${port}/audio/${path.basename(audioFile)}`;
    res.json({ audioUrl });

    setTimeout(() => {
      fs.unlink(audioFile, (err) => {
        if (err) console.error('Error deleting audio file:', err);
      });
    }, 10 * 60 * 1000);
  } catch (error) {
    res.status(500).json({ error: `Failed to synthesize speech: ${error.message}` });
  }
});

app.post('/transcribe', upload.single('audio'), async (req, res) => {
  const audioFilePath = req.file.path;
  const wavFilePath = path.join(uploadDir, `converted-${Date.now()}.wav`);
  console.log('Transcribe request received:', { file: req.file.originalname, size: req.file.size });

  try {
    await convertToWav(audioFilePath, wavFilePath);

    const speechConfig = sdk.SpeechConfig.fromSubscription(process.env.SPEECH_KEY, process.env.SPEECH_REGION);
    speechConfig.speechRecognitionLanguage = 'en-US';

    const audioConfig = sdk.AudioConfig.fromWavFileInput(fs.readFileSync(wavFilePath));
    const speechRecognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);

    let transcribedText = '';
    await new Promise((resolve, reject) => {
      speechRecognizer.recognizeOnceAsync(result => {
        switch (result.reason) {
          case sdk.ResultReason.RecognizedSpeech:
            transcribedText = result.text;
            resolve();
            break;
          case sdk.ResultReason.NoMatch:
            reject(new Error('No speech recognized'));
            break;
          case sdk.ResultReason.Canceled:
            const cancellation = sdk.CancellationDetails.fromResult(result);
            reject(new Error(cancellation.errorDetails || 'Transcription canceled'));
            break;
        }
        speechRecognizer.close();
      }, (error) => {
        speechRecognizer.close();
        reject(error);
      });
    });

    fs.unlink(audioFilePath, () => {});
    fs.unlink(wavFilePath, () => {});

    if (!transcribedText.trim()) {
      return res.status(400).json({ error: 'No speech recognized in audio' });
    }

    res.json({ text: transcribedText.trim() });
  } catch (error) {
    fs.unlink(audioFilePath, () => {});
    if (fs.existsSync(wavFilePath)) fs.unlink(wavFilePath, () => {});
    res.status(500).json({ error: `Failed to transcribe audio: ${error.message}` });
  }
});

// ✅ Serve static frontend files from ../public
app.use(express.static(path.join(__dirname, '..', 'public')));

// ✅ Catch-all to serve index.html for frontend routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ✅ Start server
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
