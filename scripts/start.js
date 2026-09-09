if (process.env.SUPABASE_URL) {
  const { startSupabaseServer } = await import('../lib/supabase-server.js');
  await startSupabaseServer();
} else {
  const { createApp } = await import('../server.js');
  const app = createApp();
  app.server.listen(Number(process.env.PORT) || 3000, '0.0.0.0');
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, async () => { await app.close(); process.exit(0); });
}
