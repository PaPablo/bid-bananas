# Bananas (app web móvil)

Juego de las bananas multijugador en tiempo real.

## Cómo correr

```bash
npm install
npm start
```

El servidor queda en `http://0.0.0.0:3000`. Para jugar desde el móvil, abrí
`http://<IP-de-tu-PC>:3000` en el navegador del teléfono (misma red WiFi).

## Cómo se juega
- Un jugador crea una sala y comparte el código.
- Los demás se unen con el código y un nick.
- El anfitrión inicia la partida. A partir de ahí no se pueden sumar jugadores.
- Cada ronda: cada jugador envía una puja (número) o vota dividir la caja.
- El servidor revela las pujas, calcula el impuesto (ganador - segundo) y otorga la caja.
- Si el ganador no puede pagar el impuesto, no gana la caja (queda para la próxima).
- Meta por defecto: 200 bananas. Configurable al crear la sala.

## Supuestos
- Bananas iniciales por jugador: 10 (configurable) para permitir pagar impuestos.
- El pozo de cada ronda equivale a las bananas del jugador con más bananas (mínimo 1).
- Ofertas del 0 a un máximo configurable (100 por defecto).
- Solo hay división del pozo cuando dos jugadores empatan por la misma oferta: cada uno paga la mitad del impuesto al segundo y se lleva la mitad del pozo (redondeando hacia abajo).
- Ya no existe la opción de "dividir entre todos": el impuesto y el reparto se resuelven automáticamente.
- Los jugadores que no ganan el crate permanecen en la partida (modo espectador).