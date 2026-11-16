#!/usr/bin/env bash
# Lista los tamanos de VM que ESTA suscripcion puede crear (sin restricciones), con su precio
# Linux por mes, para elegir el VM_SIZE/LOCATION de provision.sh (feature 017, FR-002).
#
# Uso (Azure Cloud Shell, Bash):
#   bash list-available-sizes.sh                      # regiones y rango por defecto
#   REGIONS="canadacentral chilecentral" MIN_GB=4 MAX_GB=8 bash list-available-sizes.sh
#
# Solo lee: no crea recursos ni consume credito. Cada region tarda 1-3 min.
set -euo pipefail

REGIONS="${REGIONS:-canadacentral chilecentral brazilsouth}"
MIN_GB="${MIN_GB:-4}"
MAX_GB="${MAX_GB:-8}"
MAX_CPU="${MAX_CPU:-4}"

for r in $REGIONS; do
  printf '\n== %s (consultando tamanos habilitados, 1-3 min...)\n' "$r"
  # Sin --all, list-skus devuelve solo lo que la suscripcion puede usar; ademas se filtra
  # por restrictions vacio (cubre restricciones por zona).
  az vm list-skus --location "$r" --resource-type virtualMachines -o json > "/tmp/skus-$r.json"

  python3 - "$r" "$MIN_GB" "$MAX_GB" "$MAX_CPU" "/tmp/skus-$r.json" <<'PY'
import json, sys, urllib.parse, urllib.request

region, min_gb, max_gb, max_cpu, path = sys.argv[1], float(sys.argv[2]), float(sys.argv[3]), float(sys.argv[4]), sys.argv[5]
skus = json.load(open(path))

def cap(s, name):
    for c in s.get("capabilities") or []:
        if c["name"] == name:
            return c["value"]
    return None

cands = []
for s in skus:
    if s.get("restrictions"):
        continue
    try:
        gb, cpu = float(cap(s, "MemoryGB")), float(cap(s, "vCPUs"))
    except (TypeError, ValueError):
        continue
    if min_gb <= gb <= max_gb and cpu <= max_cpu:
        cands.append((s["name"], int(cpu), gb, cap(s, "CpuArchitectureType") or "?"))

def price(sku):
    flt = (f"serviceName eq 'Virtual Machines' and armRegionName eq '{region}' "
           f"and armSkuName eq '{sku}' and priceType eq 'Consumption'")
    url = "https://prices.azure.com/api/retail/prices?" + urllib.parse.urlencode({"$filter": flt})
    try:
        items = json.load(urllib.request.urlopen(url, timeout=20))["Items"]
    except Exception:
        return None
    lin = [i["retailPrice"] for i in items
           if "Windows" not in i["productName"] and "Cloud Services" not in i["productName"]
           and "Spot" not in i["skuName"] and "Low Priority" not in i["skuName"]]
    return min(lin) * 730 if lin else None

rows = [(n, c, g, a, price(n)) for n, c, g, a in sorted(set(cands))]
rows.sort(key=lambda x: (x[4] is None, x[4] or 0))

if not rows:
    print("  (ningun tamano habilitado en ese rango)")
for n, c, g, a, p in rows:
    ps = f"{p:7.1f} USD/mes" if p is not None else "   sin precio"
    print(f"  {n:26} {c} vCPU  {g:4.1f} GB  {a:5}  {ps}")
PY
done

printf '\nPrecios: VM Linux on-demand, sin IPv4 estatica (~3,7 USD/mes) ni disco.\n'
