# Teebox ball physics

`public/physics.js` turns the five numbers a launch monitor reports (ball speed, launch angle, launch
direction, backspin, sidespin) into a flight, a bounce and a roll. Everything in between is computed from
forces on the ball. Nothing is looked up per club, and there are no per-shot-type corrections.

This page says what the model does, where each number comes from, and how far to trust it.

## Flight

The ball is a point mass (45.93 g, 42.67 mm) with a spin vector. Three forces act on it:

| Force   | Expression                         | Direction                         |
|---------|------------------------------------|-----------------------------------|
| Gravity | `m g`                              | down                              |
| Drag    | `½ ρ A Cd v²`                      | against the ball's airspeed       |
| Lift    | `½ ρ A Cl v²`                      | along `spin × airspeed` (Magnus)  |

`v` is the speed of the ball relative to the air, so wind is part of the same equations. They are integrated
with fourth-order Runge-Kutta at 250 Hz.

### Lift and drag coefficients

`Cd` and `Cl` are not constants. They depend on two dimensionless numbers:

- spin ratio `S = R ω / v` (how fast the surface spins compared with how fast the ball flies)
- Reynolds number `Re = ρ v 2R / μ` (speed, scaled by the air's density and viscosity)

```
Cl = 0.508 · S / (0.182 + S)
Cd = 0.234 + 1.04 · Cl² + 0.08 · (10⁵/Re − 1)        capped at 0.50
```

- **Lift** grows quickly with spin ratio and then levels off, as wind-tunnel measurements show.
- **Drag** has three parts: a base profile drag, a part that grows with lift squared (a spinning ball
  that makes lift pays for it in drag, the same way a wing does), and a part that rises as the ball
  slows down toward the dimpled-ball drag crisis.

Sample values, for comparison with published wind-tunnel curves:

| S    | Re      | Cd   | Cl   | Typical of               |
|------|---------|------|------|--------------------------|
| 0.08 | 200,000 | 0.22 | 0.16 | driver just after launch |
| 0.20 | 100,000 | 0.31 | 0.27 | mid iron                 |
| 0.30 | 100,000 | 0.34 | 0.32 | short iron               |
| 0.50 | 80,000  | 0.40 | 0.37 | wedge near the apex      |

**Where the constants come from.** The *shapes* are taken from the wind-tunnel literature (Bearman & Harvey
1976; Smits & Smith 1994). Their *numbers* describe balls from the 1970s to the 1990s and make a modern ball
fly wrong: Smits & Smith's published constants put a tour driver about 20 yards short and a wedge 10 yards
long. So four constants (`0.508`, `0.182`, `0.234`, `1.04`) were fitted to radar-measured carry, apex height
and landing angle for 23 club averages from the PGA and LPGA tours. The Reynolds slope (`0.08`) is not well
determined by that data, so it is set to match the slope seen in wind tunnels.

One law is fitted to all 23 clubs at once. No club gets its own correction.

### Spin decay

Spin slows in flight from skin friction (Smits & Smith):

```
dω/dt = −2×10⁻⁵ · ω · v / R
```

That is about 3 to 7 percent per second, faster when the ball is moving faster. A tour driver launched at 2,700 rpm lands with about 2,100. The
spin axis is held fixed in flight.

### Air

Air density comes from temperature, altitude and humidity (barometric formula plus the vapour pressure of
water), and viscosity from Sutherland's law. Defaults: 70 °F, sea level, 50 % humidity, which is
1.194 kg/m³.

What the model predicts for a tour driver (167 mph, 10.9°, 2,686 rpm):

| Change                    | Carry    |
|---------------------------|----------|
| Denver, 5,280 ft          | +4.6 %   |
| 40 °F instead of 70 °F    | −3 yd    |
| 100 °F instead of 70 °F   | +3 yd    |
| 10 mph headwind           | −20 yd   |
| 10 mph tailwind           | +15 yd   |

The temperature figures are for the air only. A cold ball also comes off the club slower, but the launch
monitor has already measured that.

### Wind

`windMph` is the speed at 10 m, the height weather reports use. Near the ground the wind is slower, so the
model uses the standard logarithmic profile over mown grass (roughness length 0.03 m). A low punch feels
less wind than a high wedge.

## Bounce

Each landing is a rigid sphere hitting a surface with friction, following Penner (2002):

1. **The turf gives.** The ball digs a pitch mark, so the ground pushes back as if it were tilted toward the
   ball. The tilt grows with impact speed and steepness: `15.4° · (v / 18.6 m/s) · (θ / 44.4°)`.
2. **Normal rebound.** The coefficient of restitution falls as the impact gets harder:
   `e = 0.510 − 0.0375 vₙ + 0.000903 vₙ²`, and `0.12` above 20 m/s.
3. **Friction.** The contact point slips at `v_tangent + R ω`, so backspin adds to the slip. Friction
   (μ ≈ 0.4) pushes against it. If friction is strong enough to stop the slip during contact, the ball
   leaves rolling, and what is left of its forward speed is `(5 v − 2 R ω) / 7`. With enough backspin that is
   negative: the ball checks or backs up.
4. **Rolling resistance** takes a little more off while the ball is pressed into the turf.

The same step is done in 3D, so sidespin kicks the ball sideways on landing.

## Roll

Once the hops are lower than the grass, the ball slides under kinetic friction until its spin matches its
speed, then rolls with a constant deceleration. That deceleration is set by a Stimpmeter-style number: the
distance a ball released at 1.83 m/s would roll, `a = 1.83² / 2d`.

| Turf preset  | Friction μ | Rebound × | Turf give × | Roll (Stimp ft) |
|--------------|-----------:|----------:|------------:|----------------:|
| Firm fairway | 0.40       | 1.10      | 0.65        | 5.5             |
| Fairway      | 0.40       | 1.00      | 0.85        | 4.0             |
| Soft fairway | 0.45       | 0.85      | 1.10        | 3.0             |
| Rough        | 0.50       | 0.70      | 1.30        | 1.8             |
| Green        | 0.40       | 1.00      | 1.00        | 10.0            |

## How well it matches

Carry is checked against TrackMan's published PGA Tour averages at 25 °C, sea level (model / measured):

| Club | Ball mph | Launch | Spin  | Carry yd  | Apex yd | Landing angle |
|------|---------:|-------:|------:|-----------|---------|---------------|
| DR   | 167      | 10.9°  | 2,686 | 269 / 275 | 35 / 32 | 42° / 38°     |
| 3W   | 158      | 9.2°   | 3,655 | 247 / 243 | 33 / 30 | 42° / 43°     |
| 5W   | 152      | 9.4°   | 4,350 | 233 / 230 | 33 / 31 | 44° / 47°     |
| Hy   | 146      | 10.2°  | 4,437 | 222 / 225 | 32 / 29 | 44° / 47°     |
| 3i   | 142      | 10.4°  | 4,630 | 214 / 212 | 31 / 27 | 43° / 46°     |
| 4i   | 137      | 11.0°  | 4,836 | 205 / 203 | 30 / 28 | 43° / 48°     |
| 5i   | 132      | 12.1°  | 5,361 | 194 / 194 | 30 / 31 | 44° / 49°     |
| 6i   | 127      | 14.1°  | 6,231 | 183 / 183 | 32 / 30 | 47° / 50°     |
| 7i   | 120      | 16.3°  | 7,097 | 168 / 172 | 32 / 32 | 48° / 50°     |
| 8i   | 115      | 18.1°  | 7,998 | 157 / 160 | 32 / 31 | 49° / 50°     |
| 9i   | 109      | 20.4°  | 8,647 | 146 / 148 | 32 / 30 | 49° / 51°     |
| PW   | 102      | 24.2°  | 9,304 | 132 / 136 | 32 / 29 | 51° / 52°     |

| Data set                                   | Shots | Mean carry error | Worst   |
|--------------------------------------------|------:|-----------------:|--------:|
| PGA Tour averages (used in the fit)        | 12    | 2.8 yd           | 6.1 yd  |
| LPGA Tour averages (used in the fit)       | 11    | 1.9 yd           | 4.9 yd  |
| OpenFairway reference set (not in the fit) | 175   | 2.0 yd           | 12.4 yd |

The third row is the check that matters most. It is 175 shots from 47 to 150 mph, including chips, thin
shots and low-spin drives, with reference carries from the calibration data of the
[OpenFairway](https://github.com/digitalhand/openfairway) project. None of them were used to set the
constants, and the mean error has no bias long or short (0.0 yd). Those reference carries come from another
trajectory model, not from a radar, so this shows agreement between two independent models.

`npm test` runs the tour tables as a regression test: every club within 4 % on carry, 20 % on apex and 8° on
landing angle.

## Known limits

- **The driver is about 6 yards short and lands about 4° too steep** against the tour average, and long
  irons land 3° to 5° too shallow. One smooth law cannot fit both ends exactly.
- **Roll-out is the least certain part.** The bounce model was built from measurements on greens at steep
  angles. Fairway presets are reasoned estimates, not measurements. On the default fairway a tour driver
  rolls about 10 yards and on the firm preset about 26. Low, skidding shots roll further than the
  OpenFairway reference set expects (about twice as far on average on the default fairway; the soft preset
  agrees with it most closely).
- **The ground is flat** and the same everywhere.
- **One ball.** The constants describe an average modern tour-type ball. Range balls and low-compression
  balls fly shorter, and limited-flight balls much shorter.
- **The spin axis does not move in flight**, and spin about the vertical axis is not changed by a bounce.
- **Sources.** The Smits & Smith constants were checked against a secondary source that quotes them. The
  Penner bounce constants are written from the published model and could not be re-checked against the paper
  while this was written.

## Using it from code

```js
const P = require('./public/physics.js');

const r = P.simulate(
  { speed: 120, vla: 16.3, hla: 0, backspin: 7097, sidespin: 0 },
  { tempF: 85, altitudeFt: 5280, humidity: 30, windMph: 8, windFrom: 0, surface: 'firm' },
);
// r.carryYd, r.totalYd, r.apexFt, r.landAngle, r.landSpeed, r.landSpin, r.hangTime, r.path, r.bounces, r.air
```

`windFrom` is where the wind comes from, relative to the target line: 0 is a headwind, 90 is from the right,
180 is a tailwind, 270 is from the left. `surface` is a preset name or an object
`{ mu, cor, dig, stimpFt }`. Metric inputs `tempC` and `altitudeM` work too, and `pressurePa` overrides the
altitude with a measured station pressure.

`P.atmosphere(opts)`, `P.coefficients(S, Re)`, `P.restitution(vn)` and `P.bounce(v, w, turf)` expose the
pieces. `P.AERO` and `P.SURFACES` hold every constant on this page.

## References

- P. W. Bearman and J. K. Harvey, "Golf ball aerodynamics", *Aeronautical Quarterly* 27 (1976).
- A. J. Smits and D. R. Smith, "A new aerodynamic model of a golf ball in flight", *Science and Golf II* (1994).
- A. R. Penner, "The run of a golf ball", *Canadian Journal of Physics* 80 (2002).
- A. R. Penner, "The physics of golf", *Reports on Progress in Physics* 66 (2003).
- TrackMan, PGA Tour and LPGA Tour average launch and flight data.
- [OpenFairway](https://github.com/digitalhand/openfairway) (MIT), whose physics addon inspired this
  structure: air from altitude and temperature, coefficients from Reynolds number and spin ratio, a Penner
  bounce and friction-based roll-out. No OpenFairway code is used here.
