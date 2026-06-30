'use strict';

const vm = require('vm');
const fetch = require('node-fetch');

/**
 * Run a user-defined message handler inside a restricted VM sandbox.
 *
 * The user's code is the body of an async function receiving `ctx`.
 * It may:
 *   - call ctx.reply("...") to send a message back to the same chat,
 *   - call ctx.send(chatId, "...") to message any chat,
 *   - `return "text"` to send that text as the reply,
 *   - `return false` / return nothing to send nothing,
 *   - use ctx.ai(prompt), ctx.db(name, sql, params), ctx.fetch(url, opts).
 *
 * @param {string} code
 * @param {object} ctx
 * @param {object} opts { timeoutMs }
 * @returns {Promise<{ returned:any, logs:string[] }>}
 */
async function runHandler(code, ctx, { timeoutMs = 5000 } = {}) {
  const logs = [];
  const safeConsole = {
    log: (...a) => logs.push(a.map(fmt).join(' ')),
    error: (...a) => logs.push('[error] ' + a.map(fmt).join(' ')),
    warn: (...a) => logs.push('[warn] ' + a.map(fmt).join(' ')),
    info: (...a) => logs.push(a.map(fmt).join(' ')),
  };

  // Expose a capturing logger on ctx so `ctx.log(...)` is persisted too.
  if (ctx && typeof ctx === 'object') {
    ctx.log = (...a) => safeConsole.log(...a);
  }

  const sandbox = {
    ctx,
    console: safeConsole,
    fetch,
    JSON,
    Math,
    Date,
    Number,
    String,
    Boolean,
    Array,
    Object,
    parseInt,
    parseFloat,
    encodeURIComponent,
    decodeURIComponent,
    setTimeout: undefined, // disabled
  };

  const context = vm.createContext(sandbox);
  const wrapped = `(async function(ctx){ "use strict";\n${code}\n});`;

  let fn;
  try {
    const script = new vm.Script(wrapped, { filename: 'custom-handler.js' });
    fn = script.runInContext(context, { timeout: 1000 });
  } catch (err) {
    throw new Error('Custom code compile error: ' + err.message);
  }

  // Enforce wall-clock timeout around the async handler.
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Custom handler timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    const returned = await Promise.race([fn(ctx), timeout]);
    return { returned, logs };
  } finally {
    clearTimeout(timer);
  }
}

function fmt(v) {
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

module.exports = { runHandler };
