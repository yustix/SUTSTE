"use client";

import { useEffect, useState } from "react";
import { Icon } from "./Icon";

interface Props {
  needsSetup: boolean;
  backend: string;
  warning?: string;
  onAuthenticated: () => void;
}

export function AuthGate({ needsSetup, backend, warning, onAuthenticated }: Props) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const el = document.getElementById("login-email");
    el?.focus();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, name }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "No fue posible iniciar sesion.");
      onAuthenticated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error inesperado.");
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        background: "linear-gradient(160deg,#0a3557 0%,#155a9e 55%,#2f86d1 100%)",
      }}
    >
      <form
        onSubmit={submit}
        className="card"
        style={{ width: "100%", maxWidth: 400, padding: 24, background: "#fff" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: 8,
              background: "var(--blue-800)",
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 700,
              fontSize: 12,
              letterSpacing: "0.04em",
            }}
          >
            STE
          </div>
          <div>
            <div style={{ fontWeight: 650, letterSpacing: "0.08em" }}>SUT STE</div>
            <div style={{ fontSize: 12, color: "var(--text-3)" }}>Gestion documental</div>
          </div>
        </div>

        <p style={{ fontSize: 13.5, color: "var(--text-2)", margin: "14px 0 18px" }}>
          {needsSetup
            ? "Primera vez: crea la cuenta de acceso. Solo tu y quienes registres podran ver los documentos."
            : "Ingresa tus credenciales para continuar."}
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {needsSetup && (
            <div className="field">
              <label htmlFor="login-name">Nombre</label>
              <input
                id="login-name"
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Quien administra el archivo"
                autoComplete="name"
              />
            </div>
          )}
          <div className="field">
            <label htmlFor="login-email">Correo</label>
            <input
              id="login-email"
              className="input"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="tu@correo.org"
              autoComplete="username"
            />
          </div>
          <div className="field">
            <label htmlFor="login-pass">Contrasena</label>
            <input
              id="login-pass"
              className="input"
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Minimo 6 caracteres"
              autoComplete={needsSetup ? "new-password" : "current-password"}
            />
          </div>
        </div>

        {error && (
          <div className="notice err" style={{ marginTop: 12 }}>
            {error}
          </div>
        )}

        {warning && (
          <div className="notice warn" style={{ marginTop: 12 }}>
            {warning}
          </div>
        )}

        <button className="btn primary" type="submit" disabled={busy} style={{ width: "100%", justifyContent: "center", marginTop: 16 }}>
          {busy ? <span className="spin" /> : <Icon name="logout" />}
          {busy ? "Verificando…" : needsSetup ? "Crear cuenta y entrar" : "Entrar"}
        </button>

        <div className="hint" style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 6 }}>
          <Icon name="database" size={13} />
          Almacenamiento: {backend === "neon" ? "Neon Postgres (nube)" : "local de desarrollo"}
        </div>
      </form>
    </div>
  );
}
