import { AppShell } from "@/components/AppShell";

/**
 * Una sola pantalla con vistas (subir, archivo, detalle, ajustes).
 * Toda la lógica de datos vive en el cliente: IndexedDB + sincronización con /api.
 */
export default function Page() {
  return <AppShell />;
}
