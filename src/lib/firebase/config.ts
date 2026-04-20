// ✅ Archivo “puente”
// No inicializa nada. Solo re-exporta desde config.client
// Así puedes importar siempre desde: "@/lib/firebase/config"

export * from './config.client';
export { default } from './config.client';
