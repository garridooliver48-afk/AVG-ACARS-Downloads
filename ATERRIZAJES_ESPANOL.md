# AVG ACARS — Evaluador de aterrizajes en español (PRUEBA)
**No reemplaza la versión oficial de aviacionvirtualgt.com.**

El recuadro del aterrizaje aparece completamente en español, con:
- **Velocidad vertical**, en pies/min
- **Fuerza G** en el contacto
- **Morro**, rotación en grados por segundo
- **Flotación estimada**, en segundos, y un mensaje de evaluación
- **¡DE SEDA!**, **¡MUY SUAVE!**, **ATERRIZAJE NORMAL** o **ATERRIZAJE FUERTE**

Para el tiempo de flotación primero se busca el inicio de la **recogida** usando datos de cabeceo y cambios en el descenso; si no se identifica con fiabilidad, se aproxima desde la entrada a los últimos 20 pies sobre el terreno hasta tocar pista. Es una estimación de entrenamiento, **no una medición certificada ni necesariamente equivalente a otros complementos**. Si faltan datos, muestra «—» en lugar de inventar resultados.

## Prueba sin generar vuelos
1. Cierra por completo cualquier ACARS anterior.
2. Extrae **todos** los archivos del ZIP en una carpeta nueva.
3. Ejecuta AVG ACARS XPLANE.exe o AVG ACARS.exe.
4. Carga el simulador y pulsa **Iniciar prueba de aterrizaje**, sin requerir una misión AVG.
5. Haz un despegue y un aterrizaje; el resultado debería mostrarse durante siete segundos.
6. Pulsa **Detener prueba**. Reinicia ACARS antes de realizar una misión oficial.

En el modo de entrenamiento **no se envían posiciones a AVG, no se crea PIREP, no se generan puntos ni se reportan alertas de accidente al servidor**. La función de evaluación es únicamente local, independiente del sistema de accidentes.

Las pruebas automáticas de Windows son necesarias pero no sustituyen una prueba real con X-Plane/MSFS. No instalar masivamente a los pilotos hasta confirmar las mediciones y la visualización.
