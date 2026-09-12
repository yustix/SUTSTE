/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // La extracción de texto (PDF/DOCX) ocurre 100% en el navegador.
  // El archivo binario se sube a Vercel Blob desde el cliente (client upload token),
  // por lo que nunca atraviesa el límite de 4.5 MB del cuerpo de una Serverless Function.
  webpack: (config) => {
    // Emite el worker de pdf.js como archivo estático sin analizar su contenido.
    config.module.noParse = /pdf\.worker\.min\.mjs$/;
    config.module.rules.unshift({
      test: /pdf\.worker\.min\.mjs$/,
      type: "asset/resource",
      generator: { filename: "static/media/[name][ext]" },
    });
    return config;
  },
};

export default nextConfig;
