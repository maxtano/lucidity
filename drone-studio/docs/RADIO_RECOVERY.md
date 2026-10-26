# Lucidity One radio recovery

Use this for the SpeedyBee F405 Mini with the Vimdrones ESP32-C6 AIR radio on
T3/R3 and the USB GROUND radio. Keep every propeller removed during bench
diagnosis. A USB port opening or the GROUND radio's own heartbeat is **not** a
working aircraft link. The pass condition is a fresh ArduCopter heartbeat and
updating aircraft telemetry in Lucidity.

## What happened on October 18, 2026

The GROUND USB radio continued sending its own heartbeat, but Lucidity received
no aircraft data. Direct FC USB still showed a healthy ArduCopter connection and
SERIAL3 configured for MAVLink2 at 115200. Following a full radio reset, AIR had
lost its UART settings. AIR was flashed with the standard DroneBridge 2.4.1
ESP32-C6 build (not USBSerial), then configured for ESP-NOW LR AIR, channel 6,
MAVLink, TX GPIO 5, RX GPIO 4, and 115200 baud. GROUND retained its USBSerial
firmware and reported ESP-NOW GND mode.

With AIR temporarily in setup Wi-Fi mode, Lucidity read **403 UART bytes and 19
decoded MAVLink messages**. That showed the FC-to-AIR serial path carried valid
MAVLink at that moment. After AIR was restored to ESP-NOW AIR mode, the operator
reported the aircraft link working again, and Lucidity recorded fresh ArduCopter
telemetry. The exact final cause of the RF outage is **not proven**: we did not
capture a successful binding acknowledgement or a second timed AIR counter
sample. Do not infer that reflashing, resetting, or repeating BOOT presses is
normally necessary.

## If the link drops again

For a normal start, plug in GROUND USB first so Lucidity can listen, then power
the aircraft/AIR. ESP-NOW is connectionless, so this is a convenient check
order, not a required pairing or boot sequence. Do not press BOOT during a
normal start.

1. With props off, power the aircraft and connect GROUND USB. In **Tools → ESP &
   radio links**, scan and check the connection. Look for a **fresh aircraft**
   heartbeat, not merely “listening” or received packet counts.
2. If AIR's `DroneBridge for ESP32` setup Wi-Fi is visible, AIR may be in setup
   mode instead of ESP-NOW. Join that Wi-Fi, select **Aircraft air radio** in
   Lucidity's **DroneBridge radio check**, then use **Restore air mode**. Return
   the Mac to normal Wi-Fi and check the GROUND USB aircraft link again. The
   restore changes only AIR's mode; it does not rotate pairing secrets.
3. If there is still no aircraft, do not start a show or repeatedly reset the
   radios. For one diagnostic, disconnect GROUND USB, briefly press AIR **BOOT
   once** to enter setup Wi-Fi, join it, and click **Check radio** twice about
   ten seconds apart. Record both UART byte and decoded-message counts **before**
   restoring AIR mode. Rising decoded-message counts point past the FC-to-AIR
   cable toward AIR/GROUND RF configuration or pairing; flat or invalid counts
   call for a UART/FC check. Restore AIR mode before leaving setup Wi-Fi.
4. If AIR receives valid MAVLink but GROUND still has no aircraft heartbeat,
   compare non-secret AIR/GROUND mode and channel, then perform one controlled
   binding attempt if needed. Stop if its outcome cannot be verified. Do not
   factory-reset, reflash, rotate a link secret, or change FC settings as a
   first troubleshooting step.

If the Mac loses internet while joined to radio setup Wi-Fi, the local Lucidity
page at `http://127.0.0.1:5173/` still runs. Record the two counters, restore
AIR mode, reconnect normal Wi-Fi, then share the readings.
