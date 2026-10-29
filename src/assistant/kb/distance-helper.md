---
id: distance-helper
title: Work out travel and transport distances
roles: [User]
paths: [/data/new]
keywords: [distance, calculate distance, km, kilometres, travel, trip, transport, route, flight, road, rail, sea, commuting, from and to, trip calculator]
---
For travel and transport rows, **Calculate distance** works out the distance between two places for you.

1. In [Add data](/data/new), on a row with a distance field, choose **Calculate distance**.
2. Pick the **Travel mode**: **Road**, **Rail**, **Air** or **Sea**.
3. Search for the **From** and **To** places and pick a suggestion. **Swap from and to** reverses them.
4. Check the distance and the route on the map.
5. Choose **Use this distance**. It goes into the row in the row's unit.

**How each mode is worked out**
- **Road**: the road route.
- **Rail**: estimated from the road route. If no road route is found, the straight line × 1.2.
- **Air**: the straight line between the two places (great circle).
- **Sea**: the sea route. If the sea-route service doesn't answer, the straight line.

When the distance is an estimate, the drawer says "The entry is saved as an estimate". If you type over the distance yourself, it's no longer marked as an estimate.

**Rows with a count and a distance**
Some forms multiply a count, such as passengers or trips, by a distance. The row shows both fields: type the count, and use **Calculate distance** for the distance.

**Commuting rows**
Some commuting forms have a **Trip calculator**. Enter the **One-way distance**, **Days commuted in the year** and **People**; it works out the distance there and back. Then choose **Use for …** to put it in the row.

**Problems**
- "Couldn't find that place": try a fuller address, or pick a suggestion.
- "From and to are the same place": pick two different places.
- If the map can't load, the distance is still worked out.
