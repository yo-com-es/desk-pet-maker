# Criadero — taller de mascotas 3D

Visor/animador para tus modelos `.glb`, pensado como primer paso hacia un desktop pet / shimeji con
personajes 3D propios.

> **Nota de esta versión:** la carpeta `models/` viene vacía — ya no trae el dragón, el león ni el gecko
> precargados. La app arranca en blanco: arrastra tu propio `.glb` sobre el recuadro de Base A/B (o usa el
> botón "Cargar mi archivo .glb…") para empezar. Esto es a propósito, para poder pasarle esta carpeta a
> cualquiera y que la use directo con sus propios modelos, sin cargar peso extra que no necesita.
> Las secciones de abajo que mencionan esos tres modelos incluidos son de una versión anterior del
> proyecto — se dejan como historial, pero ya no aplican.

## Último arreglo: el jinete quedaba flotando al montar

Antes, al darle a "Montar", B se colocaba usando el offset que tuvieran los sliders mountX/Y/Z en ese
momento (normalmente 0), lo que casi siempre lo dejaba flotando sobre el hueso de montura en vez de pegado
a la superficie de A. Había una forma de arreglarlo (botón "Pegar a superficie"), pero había que acordarse
de darle clic aparte cada vez. Ahora, al montar, se calcula y aplica ese ajuste automáticamente — B queda
pegado al hueso desde el primer momento, sin flotar. Los sliders mountX/Y/Z y el botón "Pegar a superficie"
siguen ahí después por si quieres subirlo, bajarlo o correrlo tú a mano.

## El botón "Pegar a superficie" no hacía nada — causa real encontrada

El bug real: al montar, B queda técnicamente colgado *dentro* del propio árbol de huesos de A
(`bone.add(seat); seat.add(B.group)`, para que B siga a A si A se mueve/anima). El código que buscaba "la
superficie de A" tirando un rayo hacia abajo escaneaba TODO el árbol de A para chocar contra él — pero como
B ya vive ahí adentro, el rayo chocaba primero contra el propio B (que ya estaba flotando) en vez de la
superficie real de A. El cálculo terminaba devolviendo casi la misma posición en la que B ya estaba, una y
otra vez — por eso el botón parecía no hacer nada. Lo reproduje con un caso mínimo fuera de la app para
confirmarlo antes de tocar el código real, y ya está corregido: el rayo ahora excluye explícitamente el
subárbol de B, así que solo puede chocar contra la malla real de A. De paso también se fuerza a
recalcular el volumen delimitador de las mallas con esqueleto antes de cada rayo (three.js lo cachea una
sola vez y, si A sigue animándose, esa caché puede quedar vieja).

## Arreglado en esta versión

- **Texturas del león ya no se invierten** (cara en el cuerpo, cuerpo en la cara). La causa real: mi
  compresión anterior usaba un paso de gltf-transform (`palette`, que fusiona materiales en un atlas) que no
  se llevaba bien con este modelo en particular, porque sus 5 partes con textura ya comparten una sola imagen
  entre sí (cada una usa su propia región de UV, no una textura aparte). Lo regeneré sin ese paso — el
  `models/leon.glb` que viene aquí ya no lo toca, quedó a 130MB (bajado de 218MB) con las texturas 100%
  intactas. Si en algún momento quieres que intente comprimirlo más agresivo (bajando aún más de tamaño),
  dime y pruebo otra vía — con esta garantizo que no se rompen las texturas, aunque pese más de lo ideal.
- **Montar ya no deja al jinete flotando.** El cálculo de "cuánto bajarlo para que quede sentado" estaba
  revisando primero el hueso equivocado en humanoides (el brazo en vez de la pierna), y si por algún motivo
  no encontraba ningún hueso de pierna mapeado, no bajaba nada — dejando al jinete con los pies clavados en
  el punto de montura y el cuerpo entero flotando por encima. Los dos casos están corregidos.
- **Rueda de color completa** en las dos pestañas de pintura (Pintar y Pelo) — círculo de matiz+saturación
  más una barra de brillo, en vez de solo el cuadradito nativo del navegador.
- **Pinceles con imagen propia.** Puedes subir cualquier PNG (idealmente con transparencia) como estampa —
  sirve para pinceles exportados de SAI, Photoshop, etc. como imagen. *Importante:* no puedo leer archivos
  `.sut` nativos de SAI directamente — es un formato propietario de Celsys sin especificación pública — pero
  si exportas o recortas tu pincel como imagen normal (PNG/JPG), funciona igual aquí. También hay 4 pinceles
  de fábrica (redondo suave, redondo duro, disperso/mechones, rayitas) sin necesidad de subir nada.
- **Exportar con animación incluida.** Nuevo panel "Exportar" — hornea el ciclo de animación que esté sonando
  ahora mismo (Caminar, Correr, Bailar, lo que sea) dentro de un `.glb` nuevo, con el pelo pintado y la piel
  pintada ya incluidos, listo para que cualquiera lo abra en Blender/Unity/Godot sin este programa.

**Sobre "no se deja arrastrar":** revisé el código de arrastrar personajes en el visor (clic sostenido sobre
uno para acercarlo a otro) y no encontré un bug concreto ahí — debería funcionar mientras no estés en modo
pintura ni el personaje esté montado. Es posible que lo que viste haya sido el archivo de 218MB del león
poniendo lento/trabado el navegador entero (arreglado arriba). Pruébalo de nuevo con esta versión — si
sigue sin dejarte, dime exactamente qué intentabas arrastrar (¿un personaje? ¿la cámara/vista? ¿algo del
panel?) para poder reproducirlo bien.

## Cómo correrlo

Necesitas Python (ya lo trae Windows 10/11, macOS y Linux normalmente). No requiere instalar nada más.

1. Descomprime esta carpeta.
2. Abre una terminal dentro de ella.
3. Ejecuta:
   ```
   python3 server.py
   ```
   (en Windows puede ser `python server.py`)
4. Se abre solo en tu navegador `http://localhost:8000`. Si no, ábrelo a mano.

No puedes abrir `index.html` con doble clic directamente — los navegadores bloquean cargar archivos `.glb`
locales sin un servidor. Por eso el `server.py`.

## Qué incluye ya

- **Carga de tus propios modelos**: arrastra tu `.glb` sobre el recuadro de cada Base (A o B) — o toca el
  recuadro / usa el botón "Cargar mi archivo .glb…" para elegirlo del explorador. La carpeta `models/` trae
  tus tres modelos (dragón, gecko, león) ya listos por si quieres arrastrarlos directo sin ir a buscarlos —
  no se cargan solos, es nomás para tenerlos a la mano.
- **Mapeo de huesos automático**: al cargar cualquier modelo (los tres que ya vienen, o uno tuyo nuevo), el
  programa analiza el esqueleto en su pose de reposo y arma el mapeo solo — detecta patas/piernas, columna,
  cola, cabeza/cuello y (en humanoides) brazos, sin que tengas que tocar nada. Puedes darle directo a
  Caminar/Correr apenas carga. Si alguna vez quieres re-mapear (por ejemplo tras tocar algo a mano), hay un
  botón "🪄 Auto-mapear huesos" en la pestaña Huesos. Puedes seguir corrigiendo a mano cualquier hueso
  puntual si algo no te convence — el auto-mapeo es el punto de partida, no un candado.
- **Escala relativa**: control de "B es X% de la altura de A", con botón de autoescalado, para que un jinete
  no te salga más grande que el dragón.
- **Montar B sobre A, sentado y sin deformarse**: eliges el hueso del lomo/espalda del modelo A y B queda
  "sentado" sobre él usando un anclaje que neutraliza la rotación/escala propia de ese hueso — así B no sale
  aplastado, girado de lado ni hundido dentro de A, sin importar cómo esté armado el rig de A. Con offset de
  posición y rotación ajustable. La casilla "Sentado (a caballo)" pone las piernas de B en pose de montar
  (muslos abiertos, rodillas dobladas hacia los costados) en vez de dejarlo parado tieso encima. Si A se mueve
  o se anima, B se mueve con él.
- **Interacción de acariciar, en cualquier dirección**: eliges quién acaricia y a quién (y hay un botón
  "🔁 Invertir" para cambiarlo al toque), le das al botón, y por ~3 segundos el que acaricia estira pata/cabeza
  hacia el otro mientras el otro reacciona (cola contenta, cabeza ladeada), y luego ambos vuelven a su
  animación anterior. Funciona igual sin importar cuál personaje es el humanoide y cuál el cuadrúpedo.
- **Bailar**: nuevo botón junto a Reposo/Caminar/Correr — movimiento más grande y con balanceo de cuerpo,
  para tus dos personajes (o los que cargues) sueltos moviéndose a su rollo.
- **Pintura tipo lienzo en blanco** (estilo Mecca Chameleon / Mii): pintas directamente sobre la piel/ropa
  del modelo con el mouse, sin tocar la malla ni el rig — solo la textura. Incluye borrador, deshacer,
  restablecer, y una paleta rápida.
- **Pelo pintado a mano, pegado al frente del modelo (no a un hueso)**: pintas el pelo tú mismo en un lienzo
  transparente (pincel, cubeta, borrador, candado de transparencia), y esa placa recortada se pega directo al
  frente de la cara (para humanoides) o arriba/atrás de la cabeza (para dragones, zona de cuernos) — usando la
  caja del modelo, nunca el hueso de la cabeza, así no sale girado raro según cómo esté armado el esqueleto de
  cada personaje.
- **App de escritorio para el taller (no una mascota)**: carpeta `electron/` — empaqueta el editor completo
  (el mismo que ves con `server.py` en el navegador: paneles, pintura, huesos, exportar) en un programa normal
  con doble clic, sin necesitar terminal ni Python instalado. Esto es para **personalizar y animar** tus
  modelos de OCs — la mascota de escritorio que camina sola por la pantalla es una fase aparte que todavía no
  está en este repositorio.

## Ponerlo online (sin instalar nada, tipo "abrir un link")

Esto es un sitio 100% estático (HTML + JS + los `.glb`), así que corre en cualquier hosting gratis sin
necesitar servidor, base de datos ni nada — solo subes la carpeta `deskpet/` (menos la subcarpeta
`electron/`, esa es aparte) y listo.

**La forma más rápida — Netlify Drop (literal arrastrar y soltar, sin cuenta):**
1. Entra a [app.netlify.com/drop](https://app.netlify.com/drop) desde tu navegador.
2. Arrastra la carpeta `deskpet` completa (la que tiene `index.html` adentro) sobre esa página.
3. En segundos te da un link público tipo `algo-random.netlify.app` que ya funciona para cualquiera, desde
   cualquier compu o celular, sin instalar nada de nada. Ese link es temporal si no creas cuenta — si quieres
   que sea permanente, te pide crear una cuenta gratis (con Google/GitHub/email) y ahí lo puedes "reclamar".

**La forma permanente y gratis — GitHub Pages (si ya tienes o quieres cuenta de GitHub):**
1. Crea un repositorio nuevo en GitHub y sube el contenido de la carpeta `deskpet` (sin la subcarpeta
   `electron`).
2. Repositorio → Settings → Pages → Source: rama `main`, carpeta `/ (root)` → Save.
3. GitHub te da un link fijo tipo `tuusuario.github.io/nombre-del-repo` que ya no cambia nunca.

Con cualquiera de las dos, cualquiera que entre a ese link ya tiene el visor completo funcionando en su
navegador — cargar modelos, mapear huesos, montar, pintar, pelo, bailar, acariciar — todo, sin instalar
Python ni Node ni nada. Los archivos `.glb` que ya vienen (dragón y gecko) se sirven solos; si alguien quiere
cargar su propio modelo, lo hace con el botón de "Cargar mi archivo .glb…" igual que ahora, ese siempre
funciona 100% en el navegador de quien lo use, no se sube a ningún lado.

**Sobre lo de "que sea como las de Java" (mascota de escritorio sin instalar apenas nada):**
Aquí hay una limitación real de cómo funcionan los navegadores hoy, te lo digo derecho: una ventana
*transparente*, *sin bordes*, *siempre encima de todo* y con *clic-a-través* — como la de Electron que ya
armamos — es algo que un navegador normal **no puede hacer** por sí solo, por seguridad. Ni Chrome, ni Edge,
ni ningún navegador te deja abrir eso desde una página web pelada; siempre vas a necesitar algo que hable con
el sistema operativo — Electron es exactamente eso, y honestamente es de las opciones más ligeras que hay
para lograrlo (las alternativas tipo Tauri son más chicas al final pero para armarlas hace falta instalar
Rust, que es un intercambio peor). Las viejas mascotas de escritorio en Java (como el Shimeji original)
tampoco escapaban de esto — necesitaban tener el Java Runtime instalado, que es básicamente lo mismo que
"instalar Node para correr Electron", solo que en su época Java venía preinstalado en más compus de las que
hoy vienen con Node.

Entonces, tu combo real más práctico es:
- **Para compartir/probar rápido con quien sea, sin que nadie instale nada**: el link online de arriba, en
  el navegador. Ahí no hay mascota flotando sobre el escritorio, pero funciona 100% en cualquier lado.
- **Para tenerla de verdad flotando sobre tu escritorio**: la carpeta `electron/`, que ya armamos — es un
  `npm install` una sola vez (~2 minutos, una vez en tu vida por compu) y después `npm start` cada vez que
  la quieras abrir, nada más.

**Ya está armado el empaquetado como app instalable (.exe / .dmg)** — ver la sección
"Empaquetarlo como app instalable" más abajo. La generas apretando un botón en la web de GitHub (nada de
terminal ni de tener Node instalado vos), y a la gente que la va a usar solo le pasas un link de descarga —
ellos tampoco necesitan Node ni nada, doble clic al instalador y listo.

## Mapeo de huesos: ya es automático

Al cargar un modelo (los tres que vienen, o el tuyo), el programa ya intentó mapearlo solo apenas terminó de
cargar — revisa el cartelito debajo de "Guardar mapeo" en la pestaña **Huesos**, te dice qué detectó (patas,
cabeza, columna, brazos si es humanoide). Normalmente ya puedes darle directo a Caminar/Correr.

Si algo se ve raro (una pata que no se mueve, un giro al revés), corrígelo a mano ahí mismo: cada fila es un
hueso, con su rol asignado — cámbialo, ajusta el eje (X/Y/Z) o marca "invertir", y dale **Guardar mapeo** para
que quede recordado la próxima vez que cargues ese modelo. Si prefieres empezar de cero, el botón
**🪄 Auto-mapear huesos** vuelve a correr la detección automática en cualquier momento.

Tip para humanoides: la convención que usa el auto-mapeo (y el modo "Sentado" / el gesto de "acariciar" para
saber cuál es cuál) es piernas → `leg_bl`/`leg_br`, brazos → `leg_fl`/`leg_fr`. Si mapeas algo a mano en un
personaje bípedo, sigue esa misma convención.

## App de escritorio del taller (Electron)

Esto abre el editor completo — carga de modelos, mapeo de huesos, montar, pintar, pelo, bailar, exportar,
todo lo mismo que con `server.py` — como un programa normal con ventana, ícono y doble clic, sin necesitar
terminal ni tener Python instalado. **No** es la mascota caminando sola por el escritorio; es el taller para
personalizar y animar tus modelos de OCs, en una ventana de verdad (con bordes, redimensionable, como
cualquier programa).

1. Instala [Node.js](https://nodejs.org) si no lo tienes (trae `npm`).
2. Abre una terminal dentro de la carpeta `electron/`.
3. Ejecuta una vez:
   ```
   npm install
   ```
4. Cada vez que quieras abrirlo:
   ```
   npm start
   ```

Arranca en blanco igual que la versión de navegador — carga tu `.glb` con el botón o arrastrándolo.

La app instalable (`.exe`/`.dmg`/`.AppImage`, ver más abajo "Empaquetarlo como app instalable") abre
exactamente esta misma ventana de taller — no requiere Node ni terminal para la persona que la usa, solo
doble clic al instalador.

## Pendiente / próximas fases (te lo doy honesto, es un proyecto grande)

1. **Ícono de bandeja del sistema** con más opciones (elegir qué modelo cargar, tamaño, etc.) sin tener que
   editar código.
2. **Más gestos de interacción** entre dos personajes (saludarse, jugar) además de acariciar/bailar — se
   agregan fácil como nuevos estados en `gait.js`, mismo patrón que "pet_act"/"pet_react"/"dance".
3. **Empaquetar el modo escritorio como `.exe`** para no depender de tener Node instalado para *abrirlo*
   (sí hace falta para *generarlo*, una sola vez).

Dime cuál de estos priorizamos primero.

## Nota sobre modelos precargados

El dragón, el gecko y el león **sí vienen incluidos** en `models/` y ahora aparecen directo en los menús
desplegables "Base A" / "Base B" — no hace falta arrastrarlos a mano (aunque el arrastre de tu propio `.glb`
sigue funcionando igual, con el botón "Cargar mi archivo .glb…").

## Arreglado — por qué no se veían los modelos (la pantalla se quedaba en blanco)

La causa real, la que de verdad te tenía trabado: en `js/main.js`, la función `animate()` — el bucle que
dibuja cada cuadro — usaba una variable `clock` que **nunca se había declarado**. Eso hacía que el bucle
tronara con un error (`clock is not defined`) *antes* de llegar a la línea que efectivamente dibuja la
escena (`renderer.render(...)`). El modelo sí se cargaba por dentro (por eso el mapeo de huesos y el resto de
la interfaz reaccionaban bien), pero la pantalla del visor se quedaba negra porque nunca llegaba a
renderizar ni un solo cuadro. Ya declaré el reloj (`const clock = new THREE.Clock();`) donde debía estar. Lo
comprobé abriendo la app en un navegador de verdad (no solo leyendo el código): antes tronaba en cada cuadro,
ahora dibuja el dragón, el león y el gecko sin problema.

De paso también arreglé otras dos cosas relacionadas:

1. **El menú desplegable no tenía opciones para elegir el dragón/gecko/león** — solo dejaba "vacío" o subir tu
   propio archivo. Los tres modelos estaban en la carpeta `models/` pero no había forma de seleccionarlos
   desde la interfaz salvo arrastrándolos a mano desde tu explorador de archivos. Ya agregué las tres
   opciones al menú.
2. **La app dependía de un CDN externo (jsdelivr) para cargar Three.js.** Si ese servicio no responde (red
   restringida, bloqueador de anuncios agresivo, firewall, etc.), la página no carga *nada* — ni siquiera el
   error se ve claro, el visor simplemente se queda en blanco. Ahora Three.js y sus complementos
   (GLTFLoader, DRACOLoader, GLTFExporter, OrbitControls) viven copiados dentro del proyecto
   (`js/libs/three/`), así que no dependen de internet para funcionar. Esto también hace que cargue más
   rápido.
3. **`models/leon.glb` pesaba 130&nbsp;MB.** Eso no molestaba para correrlo en tu computadora, pero impide
   subirlo a GitHub (que rechaza archivos de más de 100&nbsp;MB) y hace que cargue muy lento en un sitio
   público. Comprimí los tres modelos con Draco (compresión de geometría, sin perder el rig ni las texturas):
   el león bajó de 130&nbsp;MB a **2.6&nbsp;MB**, el dragón de 16&nbsp;MB a 2&nbsp;MB, y el gecko de
   584&nbsp;KB a 505&nbsp;KB. El decodificador de Draco también va incluido localmente
   (`js/libs/draco/`).

**Recuerda:** nunca abras `index.html` con doble clic — los navegadores bloquean cargar archivos `.glb`
locales así. Siempre corre `python3 server.py` y usa la ventana que se abre en `http://localhost:8000`. Una
vez publicado en GitHub Pages (ver abajo) esto deja de ser un problema, porque ya no estarás abriendo un
archivo local sino una página web de verdad.

## Empaquetarlo como app instalable (.exe / .dmg), sin usar terminal

Esto genera un instalador de verdad — la gente que lo va a usar solo descarga un archivo y hace doble clic,
como cualquier programa. Todo el paso de "compilar" pasa en la nube de GitHub (gratis), apretando un botón
en la página web; vos tampoco necesitás tener Node instalado ni usar la terminal para generarlo.

**1. Subir el proyecto a GitHub (sin terminal, con GitHub Desktop):**

1. Instala [GitHub Desktop](https://desktop.github.com/) (es un programa normal, con ventanas — no es
   terminal) e inicia sesión con tu cuenta de GitHub (o crea una gratis).
2. File → **Add local repository** → elige esta carpeta `deskpet/`.
3. Si te dice que no es un repositorio git todavía, dale a "create a repository" ahí mismo.
4. Abajo a la izquierda escribe un resumen (ej: "primera versión") y dale **Commit to main**.
5. Arriba, botón **Publish repository**. Podés dejarlo público o privado — para que la gente lo pueda usar
   sin loguearse en GitHub, tiene que ser **público**.

**2. Generar los instaladores (botón, no comando):**

1. En la página de tu repositorio en github.com, andá a la pestaña **Actions**.
2. En la lista de la izquierda, click en **"Compilar y publicar Deskpet"**.
3. Botón **Run workflow** (arriba a la derecha de la lista de corridas) → te pide un número de versión
   (ej. `1.0.0`) → **Run workflow**.
4. Esperá unos 5-10 minutos — está compilando en paralelo para Windows, Mac y Linux. Podés ver el progreso
   ahí mismo.
5. Cuando termina, andá a la pestaña **Releases** del repositorio (o al link
   `https://github.com/TU-USUARIO/TU-REPO/releases`). Ahí vas a encontrar:
   - `Criadero Deskpet-Setup-1.0.0.exe` → para Windows
   - `Criadero Deskpet-1.0.0.dmg` → para Mac
   - `Criadero Deskpet-1.0.0.AppImage` → para Linux

**3. Pasarle el link a quien quieras que la use:**

Ese link de Releases es lo único que necesitan compartir: la persona entra, descarga el archivo de su
sistema operativo, y lo instala como cualquier programa (doble clic → siguiente → siguiente). No necesitan
Node, Python, ni saber qué es una terminal.

> **Nota sobre Mac:** como el `.dmg` no está firmado con un certificado de Apple (eso cuesta USD 99/año),
> Gatekeeper puede mostrar una advertencia la primera vez ("no se puede verificar el desarrollador"). Se
> resuelve fácil: clic derecho sobre la app → **Abrir** (en vez de doble clic) → confirmar. Solo hace falta
> esa vez.

**Cada vez que hagas cambios al código:** repetí el paso 1 (Commit + Push, ya no hace falta "Publish" de
nuevo, solo el botón **Push origin**) y después el paso 2 con un número de versión nuevo (ej. `1.0.1`) para
generar instaladores actualizados.

## Publicarlo en GitHub para que cualquiera lo use

Esta carpeta ya está lista como repositorio de git (con un primer commit hecho). Para dejarlo público y que
cualquiera lo abra desde el navegador sin instalar nada:

1. Entra a [github.com/new](https://github.com/new), crea un repositorio nuevo (por ejemplo `criadero-3d`),
   **público**, y **sin** marcar "Add a README" (para no chocar con el que ya tienes).
2. En una terminal, dentro de esta carpeta (`deskpet/`), corre:
   ```bash
   git remote add origin https://github.com/TU-USUARIO/criadero-3d.git
   git branch -M main
   git push -u origin main
   ```
3. En GitHub, ve a **Settings → Pages** del repositorio. En "Build and deployment" elige **Deploy from a
   branch**, rama `main`, carpeta `/ (root)`, y dale **Save**.
4. Espera uno o dos minutos — GitHub te da la URL pública, algo como
   `https://TU-USUARIO.github.io/criadero-3d/`. Esa es la que le puedes pasar a cualquiera; les abre el taller
   directo en el navegador, ya con el dragón/gecko/león listos para elegir del menú, sin instalar Python ni
   nada.

No hace falta Git LFS ni configuración especial: con los modelos ya comprimidos, todo el repositorio pesa
unos 5&nbsp;MB, muy por debajo del límite de GitHub.
