import { useEffect, useMemo, useRef, useState } from "react";

function brMoney(n) {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function brNum(n, d = 2) {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("pt-BR", { maximumFractionDigits: d });
}
function msToHMS(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, "0")}h${String(m).padStart(2, "0")}m${String(s).padStart(2, "0")}s`;
}

// Distância entre 2 coords (metros) - Haversine
function haversineMeters(a, b) {
  const R = 6371000;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  return 2 * R * Math.asin(Math.sqrt(h));
}

const STORAGE_KEY = "app_motorista_sessoes_v1";

function loadSessions() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}
function saveSessions(list) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

export default function App() {
  // ===== Config =====
  const [tipo, setTipo] = useState("eletrico"); // eletrico | gasolina | etanol

  // Elétrico
  const [precoKwh, setPrecoKwh] = useState(1.2); // R$/kWh
  const [kwhPor100km, setKwhPor100km] = useState(15); // kWh/100km

  // Gasolina
  const [precoGasolina, setPrecoGasolina] = useState(6.29); // R$/L
  const [kmPorLitroGasolina, setKmPorLitroGasolina] = useState(14); // km/L

  // Etanol
  const [precoEtanol, setPrecoEtanol] = useState(4.29); // R$/L
  const [kmPorLitroEtanol, setKmPorLitroEtanol] = useState(9); // km/L

  // Custos
  const [aluguelDia, setAluguelDia] = useState(0);
  const [outros, setOutros] = useState(0);

  // ===== Sessão (ao vivo) =====
  const [ganhos, setGanhos] = useState(0);
  const [rodando, setRodando] = useState(false);
  const [pausado, setPausado] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [kmSessao, setKmSessao] = useState(0);

  const [gpsStatus, setGpsStatus] = useState("GPS parado");
  const [gpsAccuracy, setGpsAccuracy] = useState(null);

  // ===== Histórico =====
  const [sessions, setSessions] = useState(() => loadSessions());

  useEffect(() => {
    saveSessions(sessions);
  }, [sessions]);

  // refs
  const startMsRef = useRef(null);
  const pausedAccumRef = useRef(0);
  const tickRef = useRef(null);

  const watchIdRef = useRef(null);
  const lastPointRef = useRef(null);

  // filtros anti-km fantasma
  const MAX_ACC_METERS = 35;
  const MAX_JUMP_MPS = 60; // 216 km/h
  const MIN_STEP_METERS = 8;

  // ===== Cronômetro =====
  useEffect(() => {
    if (!rodando || pausado) return;

    tickRef.current = setInterval(() => {
      const now = Date.now();
      const base = startMsRef.current ?? now;
      const ms = now - base + (pausedAccumRef.current || 0);
      setElapsedMs(ms);
    }, 250);

    return () => clearInterval(tickRef.current);
  }, [rodando, pausado]);

  // ===== GPS =====
  function startGPS() {
    if (!("geolocation" in navigator)) {
      setGpsStatus("Seu navegador não tem GPS.");
      return;
    }

    setGpsStatus("Pedindo permissão do GPS...");

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        const t = pos.timestamp;

        setGpsAccuracy(accuracy);
        setGpsStatus("GPS ativo");

        const p = { lat: latitude, lon: longitude, t, acc: accuracy };

        if (Number.isFinite(accuracy) && accuracy > MAX_ACC_METERS) return;

        const last = lastPointRef.current;
        if (!last) {
          lastPointRef.current = p;
          return;
        }

        const dt = (p.t - last.t) / 1000;
        if (dt <= 0) {
          lastPointRef.current = p;
          return;
        }

        const dist = haversineMeters(last, p);
        const speed = dist / dt;

        if (speed > MAX_JUMP_MPS) {
          lastPointRef.current = p;
          return;
        }

        if (dist < MIN_STEP_METERS) {
          lastPointRef.current = p;
          return;
        }

        setKmSessao((prev) => prev + dist / 1000);
        lastPointRef.current = p;
      },
      (err) => setGpsStatus(`Erro GPS: ${err.message}`),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 }
    );
  }

  function stopGPS() {
    if (watchIdRef.current != null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    lastPointRef.current = null;
    setGpsStatus("GPS parado");
  }

  // ===== Cálculos ao vivo =====
  const calc = useMemo(() => {
    const horas = elapsedMs / 3600000;

    let gastoEnergia = 0;
    let consumoLabel = "";

    if (tipo === "eletrico") {
      const kwhPorKm = kwhPor100km / 100;
      const kwhUsados = kmSessao * kwhPorKm;
      gastoEnergia = kwhUsados * precoKwh;
      consumoLabel = `${brNum(kwhPor100km)} kWh/100km`;
    } else if (tipo === "gasolina") {
      const litros = kmPorLitroGasolina > 0 ? kmSessao / kmPorLitroGasolina : 0;
      gastoEnergia = litros * precoGasolina;
      consumoLabel = `${brNum(kmPorLitroGasolina)} km/L`;
    } else {
      const litros = kmPorLitroEtanol > 0 ? kmSessao / kmPorLitroEtanol : 0;
      gastoEnergia = litros * precoEtanol;
      consumoLabel = `${brNum(kmPorLitroEtanol)} km/L`;
    }

    const mediaHora = horas > 0 ? (Number(ganhos) || 0) / horas : 0;
    const custosTotais = gastoEnergia + (Number(outros) || 0) + (Number(aluguelDia) || 0);
    const ganhoFinal = (Number(ganhos) || 0) - custosTotais;

    return { horas, mediaHora, gastoEnergia, custosTotais, ganhoFinal, consumoLabel };
  }, [
    tipo,
    precoKwh,
    kwhPor100km,
    precoGasolina,
    kmPorLitroGasolina,
    precoEtanol,
    kmPorLitroEtanol,
    kmSessao,
    elapsedMs,
    ganhos,
    outros,
    aluguelDia,
  ]);

  const gastoLabel = tipo === "eletrico" ? "Gasto com energia" : "Gasto com combustível";

  // ===== Controles =====
  function iniciar() {
    setRodando(true);
    setPausado(false);
    setElapsedMs(0);
    setKmSessao(0);
    pausedAccumRef.current = 0;
    startMsRef.current = Date.now();
    startGPS();
  }

  function pausar() {
    if (!rodando || pausado) return;
    setPausado(true);

    const now = Date.now();
    const base = startMsRef.current ?? now;
    pausedAccumRef.current = now - base + (pausedAccumRef.current || 0);

    stopGPS();
  }

  function retomar() {
    if (!rodando || !pausado) return;
    setPausado(false);
    startMsRef.current = Date.now();
    startGPS();
  }

  function finalizar() {
    // salva sessão (se tiver algo útil)
    const shouldSave = (Number(ganhos) || 0) > 0 || kmSessao > 0.05 || elapsedMs > 60_000;
    if (shouldSave) {
      const now = new Date();
      const session = {
        id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
        createdAt: now.toISOString(),
        tipo,
        km: Number(kmSessao) || 0,
        elapsedMs: Number(elapsedMs) || 0,
        ganhos: Number(ganhos) || 0,
        gastoEnergia: Number(calc.gastoEnergia) || 0,
        aluguelDia: Number(aluguelDia) || 0,
        outros: Number(outros) || 0,
        lucro: Number(calc.ganhoFinal) || 0,
      };
      setSessions((prev) => [session, ...prev].slice(0, 60)); // guarda até 60 sessões
    }

    setRodando(false);
    setPausado(false);
    stopGPS();
  }

  function removeSession(id) {
    setSessions((prev) => prev.filter((s) => s.id !== id));
  }

  function clearAllSessions() {
    setSessions([]);
  }

  return (
    <div style={page}>
      <h1 style={{ marginBottom: 6 }}>Painel do Motorista (Sessão ao vivo)</h1>
      <div style={{ opacity: 0.85, marginBottom: 12 }}>
        GPS em tempo real + histórico automático ao finalizar.
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.1fr 0.9fr", gap: 14 }}>
        {/* Painel */}
        <section style={panel}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            <Box title="Meus ganhos" value={brMoney(ganhos)} sub="Digite o valor atual" />
            <Box title="Tempo online" value={msToHMS(elapsedMs)} sub={rodando ? (pausado ? "Pausado" : "Rodando") : "Parado"} />
            <Box title="Média por hora" value={brMoney(calc.mediaHora)} sub="Ganhos / hora" />

            <Box title="Km percorridos" value={`${brNum(kmSessao)} km`} sub={gpsAccuracy ? `Precisão: ~${Math.round(gpsAccuracy)}m` : "—"} />
            <Box title="Consumo carro" value={calc.consumoLabel} sub={tipo === "eletrico" ? "kWh/100km" : "km/L"} />
            <Box title={gastoLabel} value={brMoney(calc.gastoEnergia)} sub="Atualiza com o GPS" />

            <Box title="Aluguel (dia)" value={brMoney(Number(aluguelDia) || 0)} sub="Config" />
            <Box title="Outros (dia)" value={brMoney(Number(outros) || 0)} sub="pedágio/lavagem" />
            <Box title="Ganho final" value={brMoney(calc.ganhoFinal)} sub="Ganhos - custos" />
          </div>

          <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
            {!rodando && <button style={btnPrimary} onClick={iniciar}>Iniciar sessão</button>}
            {rodando && !pausado && <button style={btn} onClick={pausar}>Pausar</button>}
            {rodando && pausado && <button style={btnPrimary} onClick={retomar}>Retomar</button>}
            {rodando && <button style={btnDanger} onClick={finalizar}>Finalizar</button>}
            <span style={{ alignSelf: "center", opacity: 0.85 }}>
              Status GPS: <b>{gpsStatus}</b>
            </span>
          </div>
        </section>

        {/* Config */}
        <section style={card}>
          <h2 style={{ marginTop: 0 }}>Configuração</h2>

          <label style={label}>
            <span>Tipo</span>
            <select style={input} value={tipo} onChange={(e) => setTipo(e.target.value)}>
              <option value="eletrico">Elétrico (kWh)</option>
              <option value="gasolina">Gasolina</option>
              <option value="etanol">Etanol</option>
            </select>
          </label>

          {tipo === "eletrico" && (
            <>
              <label style={label}>
                <span>Preço do kWh (R$/kWh)</span>
                <input style={input} type="number" step="0.01" value={precoKwh} onChange={(e) => setPrecoKwh(+e.target.value)} />
              </label>
              <label style={label}>
                <span>Consumo (kWh/100km)</span>
                <input style={input} type="number" step="0.1" value={kwhPor100km} onChange={(e) => setKwhPor100km(+e.target.value)} />
              </label>
            </>
          )}

          {tipo === "gasolina" && (
            <>
              <label style={label}>
                <span>Preço gasolina (R$/L)</span>
                <input style={input} type="number" step="0.01" value={precoGasolina} onChange={(e) => setPrecoGasolina(+e.target.value)} />
              </label>
              <label style={label}>
                <span>Consumo (km/L)</span>
                <input style={input} type="number" step="0.1" value={kmPorLitroGasolina} onChange={(e) => setKmPorLitroGasolina(+e.target.value)} />
              </label>
            </>
          )}

          {tipo === "etanol" && (
            <>
              <label style={label}>
                <span>Preço etanol (R$/L)</span>
                <input style={input} type="number" step="0.01" value={precoEtanol} onChange={(e) => setPrecoEtanol(+e.target.value)} />
              </label>
              <label style={label}>
                <span>Consumo (km/L)</span>
                <input style={input} type="number" step="0.1" value={kmPorLitroEtanol} onChange={(e) => setKmPorLitroEtanol(+e.target.value)} />
              </label>
            </>
          )}

          <hr style={{ borderColor: "#222" }} />

          <label style={label}>
            <span>Meus ganhos (R$)</span>
            <input style={input} type="number" value={ganhos} onChange={(e) => setGanhos(+e.target.value)} />
          </label>

          <label style={label}>
            <span>Aluguel por dia (R$)</span>
            <input style={input} type="number" value={aluguelDia} onChange={(e) => setAluguelDia(+e.target.value)} />
          </label>

          <label style={label}>
            <span>Outros custos do dia (R$)</span>
            <input style={input} type="number" value={outros} onChange={(e) => setOutros(+e.target.value)} />
          </label>

          <div style={{ fontSize: 12, opacity: 0.75, marginTop: 10 }}>
            Dica: quando clicar <b>Finalizar</b>, a sessão salva no histórico automaticamente.
          </div>
        </section>
      </div>

      {/* Histórico */}
      <section style={{ ...panel, marginTop: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <h2 style={{ margin: 0 }}>Histórico de sessões</h2>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button style={btn} onClick={() => setSessions(loadSessions())}>Recarregar</button>
            <button style={btnDanger} onClick={clearAllSessions}>Limpar tudo</button>
          </div>
        </div>

        {sessions.length === 0 ? (
          <div style={{ opacity: 0.75, marginTop: 10 }}>Sem sessões salvas ainda. Finalize uma sessão pra gravar.</div>
        ) : (
          <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
            {sessions.map((s) => (
              <div key={s.id} style={histRow}>
                <div style={{ display: "grid", gap: 2 }}>
                  <div style={{ fontWeight: 800 }}>
                    {new Date(s.createdAt).toLocaleString("pt-BR")}
                  </div>
                  <div style={{ opacity: 0.8, fontSize: 12 }}>
                    {s.tipo.toUpperCase()} • {brNum(s.km)} km • {msToHMS(s.elapsedMs)}
                  </div>
                </div>

                <div style={{ display: "grid", gap: 2, textAlign: "right" }}>
                  <div>Ganhos: <b>{brMoney(s.ganhos)}</b></div>
                  <div style={{ opacity: 0.85, fontSize: 12 }}>
                    Energia/comb: {brMoney(s.gastoEnergia)} • Aluguel: {brMoney(s.aluguelDia)} • Outros: {brMoney(s.outros)}
                  </div>
                  <div style={{ fontSize: 14 }}>
                    Lucro: <b>{brMoney(s.lucro)}</b>
                  </div>
                </div>

                <button style={btnDangerSmall} onClick={() => removeSession(s.id)}>Apagar</button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Box({ title, value, sub }) {
  return (
    <div style={box}>
      <div style={{ fontSize: 13, opacity: 0.85 }}>{title}</div>
      <div style={{ fontSize: 22, fontWeight: 800, marginTop: 6 }}>{value}</div>
      <div style={{ fontSize: 12, opacity: 0.75, marginTop: 6 }}>{sub}</div>
    </div>
  );
}

// ===== TEMA FIXO =====
const page = {
  padding: 16,
  fontFamily: "Arial",
  maxWidth: 980,
  margin: "0 auto",
  minHeight: "100vh",
  background: "#000",
  color: "#f5f5f5",
};

const panel = {
  border: "1px solid #2a2a2a",
  borderRadius: 14,
  padding: 14,
  background: "#0b0b0b",
  color: "#f5f5f5",
  boxShadow: "0 2px 12px rgba(0,0,0,0.35)",
};

const box = {
  border: "1px solid #2a2a2a",
  borderRadius: 12,
  padding: 12,
  background: "#141414",
  color: "#f5f5f5",
  minHeight: 92,
};

const card = {
  border: "1px solid #2a2a2a",
  borderRadius: 14,
  padding: 14,
  background: "#0b0b0b",
  color: "#f5f5f5",
  boxShadow: "0 2px 12px rgba(0,0,0,0.35)",
};

const label = { display: "grid", gap: 6, marginBottom: 10 };

const input = {
  padding: "10px 10px",
  borderRadius: 10,
  border: "1px solid #333",
  background: "#0f0f0f",
  color: "#f5f5f5",
  outline: "none",
};

const btnPrimary = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid #444",
  background: "#111",
  color: "#fff",
  fontWeight: 800,
  cursor: "pointer",
};

const btn = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid #444",
  background: "#0f0f0f",
  color: "#fff",
  cursor: "pointer",
};

const btnDanger = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid #7a2b2b",
  background: "#1a0b0b",
  color: "#fff",
  cursor: "pointer",
  fontWeight: 800,
};

const histRow = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr auto",
  gap: 10,
  alignItems: "center",
  padding: 12,
  border: "1px solid #262626",
  borderRadius: 12,
  background: "#101010",
};

const btnDangerSmall = {
  padding: "8px 10px",
  borderRadius: 10,
  border: "1px solid #7a2b2b",
  background: "#1a0b0b",
  color: "#fff",
  cursor: "pointer",
  fontWeight: 800,
};
