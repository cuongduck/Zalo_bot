'use strict';

const { GoogleGenerativeAI } = require('@google/generative-ai');
const config = require('../config');

/**
 * Generate an AI reply using Google Gemini.
 * @param {object} opts
 * @param {string} opts.apiKey   - Gemini API key (falls back to global GEMINI_API_KEY)
 * @param {string} opts.model    - model name
 * @param {string} opts.systemPrompt
 * @param {string} opts.message  - user message text
 * @param {Array}  opts.history  - optional [{role:'user'|'model', text}]
 * @returns {Promise<string>}
 */
async function generateReply({ apiKey, model, systemPrompt, message, history = [] }) {
  const key = apiKey || config.gemini.apiKey;
  if (!key) throw new Error('No Gemini API key configured (set per-bot key or GEMINI_API_KEY).');

  const genAI = new GoogleGenerativeAI(key);
  const gen = genAI.getGenerativeModel({
    model: model || config.gemini.model,
    systemInstruction: systemPrompt || undefined,
  });

  const contents = [];
  for (const h of history) {
    contents.push({ role: h.role === 'model' ? 'model' : 'user', parts: [{ text: h.text }] });
  }
  contents.push({ role: 'user', parts: [{ text: message }] });

  const result = await gen.generateContent({ contents });
  return result.response.text();
}

module.exports = { generateReply };
