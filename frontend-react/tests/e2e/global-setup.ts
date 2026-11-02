/**
 * Sends one chat turn before the suite starts.
 *
 * The backend loads its safety encoders on the first chat turn, which has taken
 * 75 to 214 seconds, and the client gives up on a turn after 45. Without this,
 * whichever test sends first fails on model loading rather than on anything it
 * checks. The client's limit and the test assertions are unchanged, and real
 * first turns are still exposed to this delay.
 */
const API = "http://127.0.0.1:8117";
const WARM_LIMIT_MS = 300_000;
const HEADERS = { "Content-Type": "application/json", "X-NLCare-Data-Class": "synthetic" };

export default async function globalSetup() {
  const started = Date.now();
  const login = await fetch(`${API}/auth/demo-credential-login`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ username: "P001", password: "patient-demo" }),
  });
  if (!login.ok) throw new Error(`Warm-up login returned HTTP ${login.status}`);
  const { access_token: token } = (await login.json()) as { access_token: string };

  const turn = await fetch(`${API}/me/chat/stream`, {
    method: "POST",
    headers: { ...HEADERS, Accept: "text/event-stream", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ message: "hi" }),
    signal: AbortSignal.timeout(WARM_LIMIT_MS),
  });
  if (!turn.ok) throw new Error(`Warm-up chat turn returned HTTP ${turn.status}`);
  await turn.text();
  console.log(`Backend warmed in ${Math.round((Date.now() - started) / 1000)}s`);
}
