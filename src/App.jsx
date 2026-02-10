import { useEffect, useMemo, useRef, useState } from "react";

function brMoney(n) {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function brNum(n, d = 2) {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("pt-BR", { maximumFractionDigits: d });
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

function msToHMS(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const hh = String(h).padStart(2, "0");
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return `${hh}h${mm}m${ss}s`;
}

export default function App() {
  // ===== Config (você mexe pouco) =====
  const [tipo, setTipo] = useState("eletrico"); // eletrico | gasolina | etanol

  // Elétrico
  const [precoKwh, setPrecoKwh] = useState(1.2);      // R$/kWh
  const [kwhPor100km, setKwhPor100km] = useState(15); // kWh/100km

  // Gasolina
  const [precoGasolina, setPrecoGasolina] = useState(6.29); // R$/L
  const [kmPorLitroGasolina, setKmPorLitroGasolina] = useState(14); // km/L

  // Etanol
  const [precoEtanol, setPrecoEtanol] = useState(4.29); // R$/L
  const [kmPorLitroEtanol, setKmPorLitroEtanol] = useState(9); // km/L

  // Aluguel por dia (simples) — se quiser deixar 0, ok
  const [aluguelDia, setAluguelDia] = useState(0);

  // Outros custos do dia (pedágio etc.)
  const [outros, setOutros] = useState(0);

  // ===== Sessão (ao vivo) =====
  const [ganhos, setGanhos] = useState(0); // “Meus ganhos”
  const [rodando, setRodando] = useState(false); // sessão ativa
  const [pausado, setPausado] = useState(false);

  const [elapsedMs, setElapsedMs] = useState(0);
  const [kmSessao, setKmSessao] = useState(0);

  const [gpsStatus, setGpsStatus] = useState("GPS parado");
  const [gpsAccuracy, setGpsAccuracy] = useState(null);

  // refs pra cronômetro e GPS
  const startMsRef = useRef(null);
  const pausedAccumRef = useRef(0);
  const tickRef = useRef(null);

  const watchIdRef = useRef(null);
  const lastPointRef = useRef(null); // {lat, lon, t, acc}

  // Filtros pra evitar “km fantasma”
  const MAX_ACC_METERS = 35;   // ignora leitura com precisão ruim (maior que isso)
  const MAX_JUMP_MPS = 60;     // ignora salto muito rápido (>= 216 km/h)
  const MIN_STEP_METERS = 8;   // ignora micro-variação (ruído) abaixo disso

  // ===== Cronômetro =====
  useEffect(() => {
    if (!rodando || pausado) return;

    tickRef.current = setInterval(() => {
      const now = Date.now();
      const base = startMsRef.current ?? now;
      const ms = (now - base) + (pausedAccumRef.current || 0);
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

        // filtro 1: precisão
        if (Number.isFinite(accuracy) && accuracy > MAX_ACC_METERS) {
          // não atualiza lastPointRef pra não “pular” depois com ponto ruim
          return;
        }

        const last = lastPointRef.current;
        if (!last) {
          lastPointRef.current = p;
          return;
        }

        const dt = (p.t - last.t) / 1000; // segundos
        if (dt <= 0) {
          lastPointRef.current = p;
          return;
        }

        const dist = haversineMeters(last, p); // metros
        const speed = dist / dt; // m/s

        // filtro 2: salto absurdo
        if (speed > MAX_JUMP_MPS) {
          lastPointRef.current = p; // reseta referência, mas não soma
          return;
        }

        // filtro 3: ruído parado
        if (dist < MIN_STEP_METERS) {
          // atualiza referência devagar pra acompanhar, mas não soma km
          lastPointRef.current = p;
          return;
        }

        setKmSessao((prev) => prev + dist / 1000);
        lastPointRef.current = p;
      },
      (err) => {
        setGpsStatus(`Erro GPS: ${err.message}`);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 1000,
        timeout: 15000,
      }
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

  // ===== Controles da sessão =====
  function iniciar() {
    // reset sessão
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

    // acumula tempo até agora
    const now = Date.now();
    const base = startMsRef.current ?? now;
    const atual = (now - base) + (pausedAccumRef.current || 0);
    pausedAccumRef.current = atual;

    stopGPS();
  }

  function retomar() {
    if (!rodando || !pausado) return;
    setPausado(false);
    startMsRef.current = Date.now(); // rebase
    startGPS();
  }

  function finalizar() {
    setRodando(false);
    setPausado(false);
    stopGPS();
  }

  // ===== Cálculos ao vivo =====
  const calc = useMemo(() => {
    const horas = elapsedMs / 3600000;

    // custo por km
    let custoPorKm = NaN;
    let consumoLabel = "";
    let gastoEnergia = 0;

    if (tipo === "eletrico") {
      const kwhPorKm = kwhPor100km / 100;
      custoPorKm = precoKwh * kwhPorKm;
      const kwhUsados = kmSessao * kwhPorKm;
      gastoEnergia = kwhUsados * precoKwh;
      consumoLabel = `${brNum(kwhPor100km)} kWh/100km`;
    }

    if (tipo === "gasolina") {
      custoPorKm = kmPorLitroGasolina > 0 ? precoGasolina / kmPorLitroGasolina : NaN;
      const litros = kmPorLitroGasolina > 0 ? kmSessao / kmPorLitroGasolina : 0;
      gastoEnergia = litros * precoGasolina;
      consumoLabel = `${brNum(kmPorLitroGasolina)} km/L`;
    }

    if (tipo === "etanol") {
      custoPorKm = kmPorLitroEtanol > 0 ? precoEtanol / kmPorLitroEtanol : NaN;
      const litros = kmPorLitroEtanol > 0 ? kmSessao / kmPorLitroEtanol : 0;
      gastoEnergia = litros * precoEtanol;
      consumoLabel = `${brNum(kmPorLitroEtanol)} km/L`;
    }

    const mediaHora = horas > 0 ? ganhos / horas : 0;
    const custosTotais = gastoEnergia + (Number(outros) || 0) + (Number(aluguelDia) || 0);
    const ganhoFinal = (Number(ganhos) || 0) - custosTotais;

    return {
      horas,
      mediaHora,
      custoPorKm,
      consumoLabel,
      gastoEnergia,
      custosTotais,
      ganhoFinal,
    };
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

  const energiaLabel =
    tipo === "eletrico" ? "Energia usada" : "Combustível usado";
  const gastoLabel =
    tipo === "eletrico" ? "Gasto com energia" : "Gasto com combustível";

  return (
    <div style={{ padding: 16, fontFamily: "Arial", maxWidth: 980, margin: "0 auto" }}>
      <h1 style={{ marginBottom: 6 }}>Painel do Motorista (Sessão ao vivo)</h1>
      <div style={{ opacity: 0.8, marginBottom: 12 }}>
        Android + GPS em tempo real. (Dica: deixe o navegador com permissão de localização)
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.1fr 0.9fr", gap: 14 }}>
        {/* Painel (tipo a imagem) */}
        <section style={panel}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            <Box title="Meus ganhos" value={brMoney(ganhos)} sub="Digite o valor atual" />
            <Box title="Tempo online" value={msToHMS(elapsedMs)} sub={rodando ? (pausado ? "Pausado" : "Rodando") : "Parado"} />
            <Box title="Média por hora" value={brMoney(calc.mediaHora)} sub="Ganhos / hora" />

            <Box title="Km percorridos" value={`${brNum(kmSessao)} km`} sub={gpsAccuracy ? `Precisão: ~${Math.round(gpsAccuracy)}m` : "—"} />
            <Box title="Consumo carro" value={calc.consumoLabel} sub={tipo === "eletrico" ? "kWh/100km" : "km/L"} />
            <Box title={gastoLabel} value={brMoney(calc.gastoEnergia)} sub={energiaLabel} />

            <Box title="Aluguel (dia)" value={brMoney(Number(aluguelDia) || 0)} sub="Config" />
            <Box title="Outros (dia)" value={brMoney(Number(outros) || 0)} sub="pedágio/lavagem" />
            <Box title="Ganho final" value={brMoney(calc.ganhoFinal)} sub="Ganhos - custos" />
          </div>

          <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
            {!rodando && <button style={btnPrimary} onClick={iniciar}>Iniciar sessão</button>}
            {rodando && !pausado && <button style={btn} onClick={pausar}>Pausar</button>}
            {rodando && pausado && <button style={btnPrimary} onClick={retomar}>Retomar</button>}
            {rodando && <button style={btnDanger} onClick={finalizar}>Finalizar</button>}
            <span style={{ alignSelf: "center", opacity: 0.8 }}>
              Status GPS: <b>{gpsStatus}</b>
            </span>
          </div>
        </section>

        {/* Configs */}
        <section style={card}>
          <h2 style={{ marginTop: 0 }}>Configuração</h2>

          <label style={label}>
            <span>Tipo</span>
            <select value={tipo} onChange={(e) => setTipo(e.target.value)}>
              <option value="eletrico">Elétrico (kWh)</option>
              <option value="gasolina">Gasolina</option>
              <option value="etanol">Etanol</option>
            </select>
          </label>

          {tipo === "eletrico" && (
            <>
              <label style={label}>
                <span>Preço do kWh (R$/kWh)</span>
                <input type="number" step="0.01" value={precoKwh} onChange={(e) => setPrecoKwh(+e.target.value)} />
              </label>
              <label style={label}>
                <span>Consumo (kWh/100km)</span>
                <input type="number" step="0.1" value={kwhPor100km} onChange={(e) => setKwhPor100km(+e.target.value)} />
              </label>
            </>
          )}

          {tipo === "gasolina" && (
            <>
              <label style={label}>
                <span>Preço gasolina (R$/L)</span>
                <input type="number" step="0.01" value={precoGasolina} onChange={(e) => setPrecoGasolina(+e.target.value)} />
              </label>
              <label style={label}>
                <span>Consumo (km/L)</span>
                <input type="number" step="0.1" value={kmPorLitroGasolina} onChange={(e) => setKmPorLitroGasolina(+e.target.value)} />
              </label>
            </>
          )}

          {tipo === "etanol" && (
            <>
              <label style={label}>
                <span>Preço etanol (R$/L)</span>
                <input type="number" step="0.01" value={precoEtanol} onChange={(e) => setPrecoEtanol(+e.target.value)} />
              </label>
              <label style={label}>
                <span>Consumo (km/L)</span>
                <input type="number" step="0.1" value={kmPorLitroEtanol} onChange={(e) => setKmPorLitroEtanol(+e.target.value)} />
              </label>
            </>
          )}

          <hr />

          <label style={label}>
            <span>Meus ganhos (R$)</span>
            <input type="number" value={ganhos} onChange={(e) => setGanhos(+e.target.value)} />
          </label>

          <label style={label}>
            <span>Aluguel por dia (R$)</span>
            <input type="number" value={aluguelDia} onChange={(e) => setAluguelDia(+e.target.value)} />
          </label>

          <label style={label}>
            <span>Outros custos do dia (R$)</span>
            <input type="number" value={outros} onChange={(e) => setOutros(+e.target.value)} />
          </label>

          <div style={{ fontSize: 12, opacity: 0.75, marginTop: 10 }}>
            Dica: pra GPS ficar bom, use “alta precisão” no Android e deixe o app com permissão de localização.
          </div>
        </section>
      </div>
    </div>
  );
}

function Box({ title, value, sub }) {
  return (
    <div style={box}>
      <div style={{ fontSize: 13, opacity: 0.8 }}>{title}</div>
      <div style={{ fontSize: 22, fontWeight: 800, marginTop: 6 }}>{value}</div>
      <div style={{ fontSize: 12, opacity: 0.7, marginTop: 6 }}>{sub}</div>
    </div>
  );
}

const panel = {
  border: "1px solid #eaeaea",
  borderRadius: 14,
  padding: 14,
  boxShadow: "0 2px 12px rgba(0,0,0,0.04)",
};

const box = {
  border: "1px solid #f0f0f0",
  borderRadius: 12,
  padding: 12,
  background: "white",
  minHeight: 92,
};

const card = {
  border: "1px solid #eaeaea",
  borderRadius: 14,
  padding: 14,
  boxShadow: "0 2px 12px rgba(0,0,0,0.04)",
};

const label = { display: "grid", gap: 6, marginBottom: 10 };

const btnPrimary = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid #ddd",
  fontWeight: 800,
  cursor: "pointer",
};

const btn = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid #ddd",
  cursor: "pointer",
};

const btnDanger = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid #f0c2c2",
  cursor: "pointer",
  fontWeight: 800,
};
