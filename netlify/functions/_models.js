// YAYO — every Groq model id, in one place.
//
// On 16 August 2026 Groq shut down llama-3.3-70b-versatile and
// llama-3.1-8b-instant. Five functions each carried their own copy of those
// names, so translation, price verdicts, Assistant Yayo and website import
// all started answering 404 model_not_found on the same day — and every one
// of them caught the error and fell back quietly, so nothing said a word.
// The photo condition report had already been dead since 17 July, when
// llama-4-scout went the same way.
//
// The names live here now. When Groq retires the next one it is one edit,
// and /.netlify/functions/ai-health says which model it tested.
module.exports = {
  // reasoning and judgement: price verdicts, Assistant Yayo, import parsing
  BIG: "openai/gpt-oss-120b",
  // short, high-volume, latency-sensitive: chat translation
  FAST: "openai/gpt-oss-20b",
  // multimodal — the only one that reads an image: photo condition report
  VISION: "qwen/qwen3.6-27b",
  // speech to text for voice notes
  VOICE: "whisper-large-v3"
};
