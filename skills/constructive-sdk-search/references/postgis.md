# Creating and Querying PostGIS Spatial Search

Spatial and geospatial search using the `PostGIS` extension. Used for location-based queries, geofencing, proximity search, and spatial relationship testing.

---

## Creating Spatial Search via SDK

### Step 1: Create a geometry or geography field

```typescript
// geography: for lat/lon coordinates on the Earth's surface (most common)
const locationField = await db.field.create({
  data: {
    databaseId,
    tableId: locationsTableId,
    name: 'geom',
    type: 'geography(Point,4326)',
  },
  select: { id: true, name: true },
}).execute();
```

```typescript
// geometry: for planar coordinates or when you need full spatial operations
const areaField = await db.field.create({
  data: {
    databaseId,
    tableId: zonesTableId,
    name: 'boundary',
    type: 'geometry(Polygon,4326)',
  },
  select: { id: true, name: true },
}).execute();
```

**Geography vs Geometry:**

| | Geography | Geometry |
|---|---|---|
| **Coordinates** | Lat/lon on Earth's surface | Planar (flat) coordinates |
| **Distance units** | Meters (automatically) | Units of the coordinate system |
| **Accuracy** | Accounts for Earth's curvature | Flat-earth approximation |
| **Performance** | Slightly slower | Faster |
| **Best for** | Real-world locations, GPS data | Floor plans, game maps, small areas |

### Step 2: Create a spatial index (GiST)

```typescript
const indexResult = await db.index.create({
  data: {
    databaseId,
    tableId: locationsTableId,
    name: 'idx_locations_geom_gist',
    fieldIds: [locationField.data.createField.field.id],
    accessMethod: 'gist',
  },
  select: { id: true, name: true },
}).execute();
```

GiST is the standard index type for PostGIS spatial data.

---

## PostGIS Column Types

| Type | Example | Use Case |
|------|---------|----------|
| `geography(Point,4326)` | Store locations | GPS coordinates, addresses |
| `geography(Polygon,4326)` | Store boundaries | Geofencing, service areas |
| `geometry(Point,4326)` | Planar points | Floor plans, game worlds |
| `geometry(Polygon,4326)` | Planar polygons | Zones, regions |
| `geometry(LineString,4326)` | Lines/paths | Routes, roads |
| `geometry(MultiPolygon,4326)` | Multiple polygons | Complex boundaries |

SRID 4326 = WGS 84 (standard GPS coordinate system). Always use 4326 for real-world lat/lon data.

---

## Querying Spatial Data via GraphQL

PostGIS columns are exposed as GeoJSON objects in GraphQL. The `graphile-postgis` plugin automatically registers geometry/geography types and the `graphile-plugin-connection-filter-postgis` package provides spatial filter operators.

### GeoJSON Output

PostGIS fields return GeoJSON-structured data:

```graphql
{
  locations {
    nodes {
      id
      name
      geom {
        geojson    # Full GeoJSON object
        srid       # Spatial Reference ID (e.g. 4326)
        x          # longitude (for Point types)
        y          # latitude (for Point types)
      }
    }
  }
}
```

### Spatial Filter Operators

The connection filter PostGIS plugin exposes these operators on geometry/geography columns:

#### Relationship Operators (Boolean filters)

| Operator | Works On | Description |
|----------|----------|-------------|
| `contains` | geometry | No points of B lie outside A, at least one interior point of B in interior of A |
| `containsProperly` | geometry | B intersects interior of A but not boundary |
| `coveredBy` | geometry, geography | No point of A is outside B |
| `covers` | geometry, geography | No point of B is outside A |
| `crosses` | geometry | A and B share some but not all interior points |
| `disjoint` | geometry | A and B share no space |
| `equals` | geometry | Same geometry (direction ignored) |
| `intersects` | geometry, geography | A and B share any portion of space |
| `overlaps` | geometry | Same dimension, share space, not fully contained |
| `touches` | geometry | At least one common point, interiors don't intersect |
| `within` | geometry | A is completely inside B |
| `intersects3D` | geometry | Share any portion of space in 3D |

#### Bounding Box Operators

| Operator | Description |
|----------|-------------|
| `bboxIntersects2D` | 2D bounding boxes intersect |
| `bboxIntersectsND` | n-D bounding boxes intersect |
| `bboxContains` | A's bbox contains B's bbox |
| `bboxEquals` | Bounding boxes are identical |
| `bboxLeftOf` / `bboxRightOf` | Bbox strictly left/right |
| `bboxAbove` / `bboxBelow` | Bbox strictly above/below |
| `bboxOverlapsOrLeftOf` / `bboxOverlapsOrRightOf` | Bbox overlaps or to one side |
| `bboxOverlapsOrAbove` / `bboxOverlapsOrBelow` | Bbox overlaps or above/below |
| `exactlyEquals` | Coordinates and order are identical |

### Example: Find Locations Within a Polygon

```graphql
{
  locations(
    filter: {
      geom: {
        coveredBy: {
          type: "Polygon"
          coordinates: [[
            [-73.99, 40.73],
            [-73.98, 40.73],
            [-73.98, 40.74],
            [-73.99, 40.74],
            [-73.99, 40.73]
          ]]
        }
      }
    }
  ) {
    nodes {
      id
      name
      geom { x y }
    }
  }
}
```

### Example: Find Locations That Intersect

```graphql
{
  zones(
    filter: {
      boundary: {
        intersects: {
          type: "Point"
          coordinates: [-73.985, 40.748]
        }
      }
    }
  ) {
    nodes {
      id
      name
    }
  }
}
```

---

## Querying via Codegen SDK

```typescript
// Find locations within a bounding polygon
const result = await db.location.findMany({
  filter: {
    geom: {
      coveredBy: {
        type: 'Polygon',
        coordinates: [[
          [-73.99, 40.73],
          [-73.98, 40.73],
          [-73.98, 40.74],
          [-73.99, 40.74],
          [-73.99, 40.73],
        ]],
      },
    },
  },
  select: {
    id: true,
    name: true,
    geom: { x: true, y: true },
  },
}).execute();
```

```typescript
// Find zones that contain a point
const result = await db.zone.findMany({
  filter: {
    boundary: {
      contains: {
        type: 'Point',
        coordinates: [-73.985, 40.748],
      },
    },
  },
  select: {
    id: true,
    name: true,
  },
}).execute();
```

---

## Combining PostGIS with Text Search

PostGIS spatial queries can be combined with text search filters for location-aware search:

```typescript
// Find nearby restaurants matching a text search
const result = await db.restaurant.findMany({
  where: {
    fullTextSearch: 'italian pizza',
  },
  filter: {
    location: {
      coveredBy: {
        type: 'Polygon',
        coordinates: [boundingBox],
      },
    },
  },
  orderBy: 'SEARCH_SCORE_DESC',
  select: {
    id: true,
    name: true,
    searchScore: true,
    location: { x: true, y: true },
  },
}).execute();
```

---

## When to Use PostGIS

- Proximity search ("find restaurants within 5km")
- Geofencing ("is this point inside this boundary?")
- Spatial containment ("which zone contains this location?")
- Route and path queries
- Any query involving geographic or geometric relationships
- Combined with text search for location-aware search experiences
