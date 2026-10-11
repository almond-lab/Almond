import { handlePortfolio } from '../server/portfolio-service.mjs';

export default async function handler(req, res) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
  const init = { method: req.method, headers };
  if (!['GET', 'HEAD'].includes(req.method)) {
    if (req.body !== undefined) init.body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    else {
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (Buffer.byteLength(body) > 32_768) { res.statusCode = 413; res.end(JSON.stringify({ error: 'payload_too_large', message: 'The circuit request exceeds 32 KB.' })); return; }
      }
      init.body = body;
    }
  }
  const response = await handlePortfolio(new Request(`https://${req.headers.host}${req.url}`, init));
  res.statusCode = response.status;
  for (const [key, value] of response.headers) res.setHeader(key, value);
  res.end(await response.text());
}
