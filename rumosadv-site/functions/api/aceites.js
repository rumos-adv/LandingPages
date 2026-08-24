const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
});

export async function onRequestPost(context) {
  try {
    if (!context.env.ACEITES_DB) return json({ error: 'Banco de aceites não configurado.' }, 503);
    const body = await context.request.json();
    const required = ['nome','cpf_cnpj','email','whatsapp','marca','term_version','term_hash'];
    for (const field of required) if (!String(body[field] || '').trim()) return json({ error: 'Preencha todos os campos obrigatórios.' }, 400);
    if (body.consent !== true) return json({ error: 'É necessário concordar com o termo.' }, 400);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) return json({ error: 'Informe um e-mail válido.' }, 400);
    if (!/^[a-f0-9]{64}$/i.test(body.term_hash)) return json({ error: 'Versão do termo inválida.' }, 400);

    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const ip = context.request.headers.get('CF-Connecting-IP') || null;
    const userAgent = context.request.headers.get('User-Agent') || null;

    await context.env.ACEITES_DB.prepare(`
      INSERT INTO aceites
      (id, created_at, nome, cpf_cnpj, email, whatsapp, marca, term_version, term_hash, ip, user_agent, consent, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'aceito')
    `).bind(
      id, createdAt, String(body.nome).trim(), String(body.cpf_cnpj).trim(),
      String(body.email).trim().toLowerCase(), String(body.whatsapp).trim(), String(body.marca).trim(),
      String(body.term_version).trim(), String(body.term_hash).trim().toLowerCase(), ip, userAgent
    ).run();

    return json({ ok: true, id, created_at: createdAt }, 201);
  } catch (error) {
    console.error('aceites_error', error);
    return json({ error: 'Não foi possível registrar o aceite.' }, 500);
  }
}

export function onRequestGet() {
  return json({ error: 'Método não permitido.' }, 405);
}
