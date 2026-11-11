# AVG ACARS — Landing Feedback (vista previa)
Versión experimental para MSFS 2020 y X-Plane 11/12. La web oficial y las descargas de Seguridad 1.2 permanecen sin cambios.

## Recuadro superpuesto
Al detectar un toque real tras la aproximación:
- Vertical Speed (FPM) inmediatamente antes del contacto.
- Pico de fuerza G en los primeros ~500 ms después del contacto.
- Nose (velocidad de cambio de pitch, grados por segundo).
- Float (estimación del tiempo que el avión permanece en la zona de planeo final, desde <=20 ft AGL con descenso leve hasta tocar); si faltan datos muestra "—".
- Comentario de flare y calificación (BUTTER!, SMOOTH!, LANDING o HARD LANDING).

La presentación busca reproducir el estilo visual de la imagen de referencia, no copiar el algoritmo de ningún complemento externo. El texto "BUTTER!" **no significa** que el simulador garantice ausencia de daños.

## Protección y alcance
- Local y solo informativo: NO modifica los puntos, PIREP, registro de accidentes ni penalizaciones.
- No genera eventos si detecta pausa, replay, slew, datos discontinuos o un avion en tierra desde el inicio.
- Evita avisos repetidos por rebotes con una ventana de 15 segundos.
- Requiere conexión activa de ACARS al simulador.
- Valores aproximados: la telemetría X-Plane llega a 5 Hz; en MSFS el momento de contacto varía según SimConnect. El cálculo de "Float" es una estimación, no una medida idéntica a otros plugins.
- La supervisión de incidentes se mantiene separada e independiente.

## Instalación experimental
Descarga el ZIP del simulador, extrae todos los archivos y abre su EXE desde la carpeta extraída. No se sustituye automáticamente el acceso directo antiguo. Probar primero con un vuelo no oficial y comunicar observaciones antes de distribuir a todos los pilotos.
