/**
 * Polygon geometry and validation utilities for CameraRegion dangerous areas.
 * Polygons are represented as arrays of normalized coordinates: [[x1, y1], [x2, y2], ...]
 * with 0 <= x, y <= 1.
 */

// Orientation of triplet (p, q, r):
// 0 -> collinear, 1 -> clockwise, 2 -> counterclockwise
function orientation(p, q, r) {
  const val = (q[1] - p[1]) * (r[0] - q[0]) - (q[0] - p[0]) * (r[1] - q[1]);
  if (Math.abs(val) < 1e-9) return 0;
  return val > 0 ? 1 : 2;
}

// Check if point q lies on segment pr
function onSegment(p, q, r) {
  return (
    q[0] <= Math.max(p[0], r[0]) + 1e-9 &&
    q[0] >= Math.min(p[0], r[0]) - 1e-9 &&
    q[1] <= Math.max(p[1], r[1]) + 1e-9 &&
    q[1] >= Math.min(p[1], r[1]) - 1e-9
  );
}

// Checks if segment p1q1 and p2q2 intersect strictly
function doSegmentsIntersect(p1, q1, p2, q2) {
  const o1 = orientation(p1, q1, p2);
  const o2 = orientation(p1, q1, q2);
  const o3 = orientation(p2, q2, p1);
  const o4 = orientation(p2, q2, q1);

  // General case: lines cross
  if (o1 !== o2 && o3 !== o4) {
    return true;
  }

  // Special cases for collinearity
  if (o1 === 0 && onSegment(p1, p2, q1)) return true;
  if (o2 === 0 && onSegment(p1, q2, q1)) return true;
  if (o3 === 0 && onSegment(p2, p1, q2)) return true;
  if (o4 === 0 && onSegment(p2, q1, q2)) return true;

  return false;
}

// Computes polygon area using the Shoelace formula
function calculatePolygonArea(polygon) {
  const n = polygon.length;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += polygon[i][0] * polygon[j][1];
    area -= polygon[j][0] * polygon[i][1];
  }
  return Math.abs(area) / 2.0;
}

/**
 * Validates that polygon:
 * 1. Is an array with at least 3 points.
 * 2. Has at least 3 distinct points.
 * 3. All coordinates are normalized numbers between 0 and 1.
 * 4. Has a non-zero area.
 * 5. Does not self-intersect.
 *
 * @param {Array<[number, number]>} polygon
 * @returns {{ valid: boolean, error?: string }}
 */
function validatePolygon(polygon) {
  if (!Array.isArray(polygon)) {
    return { valid: false, error: "Polygon must be an array of [x, y] coordinates" };
  }

  if (polygon.length < 3) {
    return { valid: false, error: "Polygon must contain at least 3 points" };
  }

  // Check distinct points and coordinate ranges
  const distinctSet = new Set();
  for (let i = 0; i < polygon.length; i++) {
    const pt = polygon[i];
    if (!Array.isArray(pt) || pt.length !== 2) {
      return { valid: false, error: `Point at index ${i} must be an array of [x, y]` };
    }

    const [x, y] = pt;
    if (typeof x !== "number" || typeof y !== "number" || isNaN(x) || isNaN(y)) {
      return { valid: false, error: `Coordinates at index ${i} must be valid numbers` };
    }

    if (x < 0 || x > 1 || y < 0 || y > 1) {
      return {
        valid: false,
        error: `Coordinates at index ${i} must be normalized between 0 and 1 (got [${x}, ${y}])`,
      };
    }

    distinctSet.add(`${x.toFixed(6)},${y.toFixed(6)}`);
  }

  if (distinctSet.size < 3) {
    return { valid: false, error: "Polygon must contain at least 3 distinct points" };
  }

  // Non-zero area check
  const area = calculatePolygonArea(polygon);
  if (area < 1e-6) {
    return { valid: false, error: "Polygon has zero or negligible area" };
  }

  // Self-intersection check
  const n = polygon.length;
  for (let i = 0; i < n; i++) {
    const p1 = polygon[i];
    const q1 = polygon[(i + 1) % n];

    // Compare with non-adjacent edges
    for (let j = i + 1; j < n; j++) {
      // Skip adjacent edges
      if (Math.abs(i - j) <= 1 || (i === 0 && j === n - 1)) {
        continue;
      }

      const p2 = polygon[j];
      const q2 = polygon[(j + 1) % n];

      if (doSegmentsIntersect(p1, q1, p2, q2)) {
        return {
          valid: false,
          error: `Polygon self-intersects between edge (${i}->${(i + 1) % n}) and edge (${j}->${(j + 1) % n})`,
        };
      }
    }
  }

  return { valid: true };
}

/**
 * Point-in-polygon test using ray-casting.
 * @param {[number, number]} point [x, y]
 * @param {Array<[number, number]>} polygon
 * @returns {boolean}
 */
function isPointInPolygon(point, polygon) {
  const [x, y] = point;
  let inside = false;
  const n = polygon.length;

  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];

    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }

  return inside;
}

/**
 * Returns the bottom-center point of a person bounding box [x_min, y_min, x_max, y_max].
 * @param {[number, number, number, number]} bbox
 * @returns {[number, number]} [bottom_center_x, bottom_center_y]
 */
function getBottomCenter(bbox) {
  const [xMin, , xMax, yMax] = bbox;
  return [(xMin + xMax) / 2.0, yMax];
}

module.exports = { validatePolygon, calculatePolygonArea, isPointInPolygon, getBottomCenter, };