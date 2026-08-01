export interface Case {
  kind: string
  title: string
  grug: string
  /** Absent on the closing card, which explains rather than calls. */
  call?: {
    from: string
    to: string
    gate: string
    url: string
    request: string
    /** Which pod's sidecar decides. The marker lands there, not mid-wire. */
    enforcedAt: "downstream" | "upstream"
    /** What the mesh should answer. Anything else means the demo is not wired up. */
    expect: number
    why: string
  }
  deep: string
  downstream?: string
  upstream?: string
  /** What the team writes. */
  yaml?: string
  /** What the platform renders from it, in Istio's own words. */
  istio?: string
  /** The real files behind the snippet — the declaration, and what renders it. */
  sources: { label: string; url: string }[]
}

const WORKSPACES =
  "https://github.com/cujarrett/homelab-workspaces/blob/main/platform-connections-demo"
const HOMELAB = "https://github.com/cujarrett/homelab/blob/main"

const API_COMPOSITION = {
  label: "Api composition — renders the policy",
  url: `${HOMELAB}/platform/api/composition.yaml`,
}
const DESIGN_DOC = {
  label: "Service Mesh — design & build plan",
  url: `${HOMELAB}/docs/platform-connections.md`,
}

export const CASES: Case[] = [
  {
    kind: "on-platform → on-platform",
    title: "Not declared, so it is refused",
    grug:
      "The API was never told this caller may call it. The request reaches the API's pod and is turned away before the app ever sees it.",
    call: {
      from: "unauthorized-api",
      to: "upstream-api",
      gate: "upstream lets it in?",
      url: "/unauthorized/api/call",
      enforcedAt: "upstream",
      expect: 403,
      request: "GET upstream-api/api/v1/data",
      why: "<b>Denied.</b> Nothing was wrong with the caller — it simply was not on the list.",
    },
    deep: `<p>The callee declares who may call it, which renders one <code>AuthorizationPolicy</code> onto <b>its own</b> pod. The first ALLOW policy to select a workload makes that workload deny-by-default, so anything unnamed is refused.</p>
<p><b>Could a pod just claim to be someone else?</b> No. Identity is not a name in a header — every meshed pod holds an X.509 certificate issued to its service account, and <code>PeerAuthentication</code> in STRICT mode refuses any peer that cannot present one. The name is only checked after the certificate proves it.</p>`,
    downstream:
      "Declares nothing. Its request leaves normally — it is stopped at the far end, not this one.",
    upstream:
      "<code>provides.allowedCallers</code> → <code>AuthorizationPolicy</code> on its inbound sidecar. Returns 403.",
    yaml: `# upstream-api — the callee
provides:
  - name: data
    allowedCallers:
      - namespace: platform-connections-demo
        app: authorized-api
# unauthorized-api is absent, so it is denied`,
    istio: `# both land on upstream-api's own pod
apiVersion: security.istio.io/v1
kind: PeerAuthentication
metadata:
  name: upstream-api
spec:
  selector:
    matchLabels: { app.kubernetes.io/instance: upstream-api }
  mtls:
    mode: STRICT   # no certificate, no conversation
---
apiVersion: security.istio.io/v1
kind: AuthorizationPolicy
metadata:
  name: upstream-api
spec:
  selector:
    matchLabels: { app.kubernetes.io/instance: upstream-api }
  action: ALLOW
  rules:
    # provides: data
    - from:
        - source:
            principals:
              - "cluster.local/ns/platform-connections-demo/sa/authorized-api"
# unauthorized-api names no rule, and ALLOW makes the rest a wall`,
    sources: [
      { label: "upstream-api.yaml — the grant", url: `${WORKSPACES}/upstream-api.yaml` },
      API_COMPOSITION,
    ],
  },
  {
    kind: "on-platform → on-platform",
    title: "Declared, so it works",
    grug: "Same API, same image, same network as the last call. This caller is on the list.",
    call: {
      from: "authorized-api",
      to: "upstream-api",
      gate: "upstream lets it in?",
      url: "/authorized/api/call",
      enforcedAt: "upstream",
      expect: 200,
      request: "GET upstream-api/api/v1/data",
      why: "<b>Allowed.</b> One line of declaration is the entire difference from the previous call.",
    },
    deep: `<p>The same policy object as before — this caller's identity appears in its rule, so the request passes. Both callers run a byte-identical image; only the declaration differs, which is the whole point.</p>
<p>The grant is <b>coarse by default</b>: no methods or paths means the whole API. Narrow it only when one API has more than one trust boundary, such as <code>/public/</code> versus <code>/admin/</code>.</p>`,
    downstream:
      "Still declares nothing for this call. On-platform destinations need no declaration from the caller.",
    upstream:
      "Same <code>AuthorizationPolicy</code>. This caller's identity matches a rule, so it passes.",
    yaml: `# upstream-api — the callee
provides:
  - name: data
    allowedCallers:
      # ↓ the whole difference
      - namespace: platform-connections-demo
        app: authorized-api`,
    istio: `# the same object as the previous call, unchanged
apiVersion: security.istio.io/v1
kind: AuthorizationPolicy
metadata:
  name: upstream-api
spec:
  selector:
    matchLabels: { app.kubernetes.io/instance: upstream-api }
  action: ALLOW
  rules:
    # provides: data
    - from:
        - source:
            principals:
              # ↓ the identity the caller proved with its certificate
              - "cluster.local/ns/platform-connections-demo/sa/authorized-api"
# no methods and no paths, so the grant covers the whole API`,
    sources: [
      { label: "upstream-api.yaml — the grant", url: `${WORKSPACES}/upstream-api.yaml` },
      API_COMPOSITION,
    ],
  },
  {
    kind: "on-platform → off-platform",
    title: "An unregistered address is refused",
    grug: "The app tries to reach a site nobody registered. The request never leaves its own pod.",
    call: {
      from: "authorized-api",
      to: "example.com",
      gate: "may I leave?",
      url: "/authorized/api/leak",
      enforcedAt: "downstream",
      expect: 502,
      request: "GET https://example.com",
      why: "<b>Blocked at its own sidecar.</b> The packet never reaches the internet.",
    },
    deep: `<p>Off-platform is the mirror image of the first two calls. There is no pod on the far end to hold a policy, so the only place to decide is the caller's own outbound sidecar.</p>
<p>Its <code>Sidecar</code> runs in <code>REGISTRY_ONLY</code> mode: it may reach cluster services in its own namespace, the control plane, and the hosts it declared. Nothing else exists as far as it is concerned.</p>`,
    downstream:
      "<code>Sidecar</code> + <code>REGISTRY_ONLY</code> on its outbound side. <code>example.com</code> is not listed, so the call dies here.",
    upstream:
      "Nothing. It is a website on the internet — no sidecar, and it never learns the call was attempted.",
    yaml: `# authorized-api — the caller
consumes:
  - host: api.open-meteo.com
# example.com is absent, so it is unreachable`,
    istio: `# lands on authorized-api's own pod
apiVersion: networking.istio.io/v1
kind: Sidecar
metadata:
  name: authorized-api
spec:
  workloadSelector:
    labels: { app.kubernetes.io/instance: authorized-api }
  outboundTrafficPolicy:
    mode: REGISTRY_ONLY   # unknown address means no address
  egress:
    - hosts:
        - "istio-system/*"          # the control plane
        - "./api.open-meteo.com"    # the one host it declared
# example.com is on no list, so the sidecar has nowhere to send it`,
    sources: [
      { label: "authorized-api.yaml — what it declares", url: `${WORKSPACES}/authorized-api.yaml` },
      API_COMPOSITION,
    ],
  },
  {
    kind: "on-platform → off-platform",
    title: "A registered address works",
    grug: "Same app, same internet. This address was declared, so the call goes out.",
    call: {
      from: "authorized-api",
      to: "api.open-meteo.com",
      gate: "may I leave?",
      url: "/authorized/api/weather",
      enforcedAt: "downstream",
      expect: 200,
      request: "GET https://api.open-meteo.com/v1/forecast",
      why: "<b>Allowed.</b> Declaring the host is what makes it reachable.",
    },
    deep: `<p>Declaring the host renders a <code>ServiceEntry</code>, putting it in this pod's registry, and adds it to the <code>Sidecar</code> egress list. Both are needed: the entry makes the address <b>known</b>, the egress line makes it <b>permitted for this workload specifically</b>.</p>
<p>That second part matters. A <code>ServiceEntry</code> is registered namespace-wide, so without the per-workload egress line a neighbour in the same namespace would inherit the ability to reach it.</p>`,
    downstream:
      "<code>consumes.host</code> → a <code>ServiceEntry</code> plus an egress entry, both scoped to this pod.",
    upstream:
      "Still nothing. The site checks no identity — the mesh controls which workload may reach it, from this end.",
    yaml: `# authorized-api — the caller
consumes:
  - host: api.open-meteo.com
# declared, so this one is reachable`,
    istio: `# both land on authorized-api's own pod
apiVersion: networking.istio.io/v1
kind: ServiceEntry
metadata:
  name: authorized-api-api-open-meteo-com
spec:
  hosts:
    - "api.open-meteo.com"
  location: MESH_EXTERNAL
  resolution: DNS
  exportTo: ["."]        # this namespace only
  ports:
    - number: 443
      name: tls
      protocol: TLS      # the app's own TLS passes straight through
---
apiVersion: networking.istio.io/v1
kind: Sidecar
metadata:
  name: authorized-api
spec:
  egress:
    - hosts:
        - "istio-system/*"
        - "./api.open-meteo.com"   # known is not enough — this line permits it
# the entry makes the host known, the egress line makes it this pod's to reach`,
    sources: [
      { label: "authorized-api.yaml — what it declares", url: `${WORKSPACES}/authorized-api.yaml` },
      API_COMPOSITION,
    ],
  },
  {
    kind: "on-platform → off-platform",
    title: "A bound resource declares itself",
    grug:
      "The app writes an object to cloud storage, reads it back, then deletes it. It never declared the address — asking for the bucket was the declaration.",
    call: {
      from: "authorized-api",
      to: "s3.amazonaws.com",
      gate: "may I leave?",
      url: "/authorized/api/storage",
      enforcedAt: "downstream",
      expect: 200,
      request: "PutObject → GetObject → DeleteObject",
      why: "<b>Allowed.</b> The bucket reference is what opened the path to it.",
    },
    deep: `<p>The two calls above needed a <code>consumes</code> entry because nothing else stated where they were going. This one does not. The app asked the platform for a bucket, and a bucket implies exactly one endpoint — so the platform registers it, the same way it registers a cache the app created itself.</p>
<p><b>Three round trips are actually happening.</b> Before any of them, a sidecar exchanges this pod's identity certificate for temporary cloud credentials, which is a call to two more endpoints the app never named. All of it is refused unless registered, so the platform registers those too — miss them and the pod starts cleanly, then fails every call with no clue pointing at the mesh.</p>
<p>Nothing durable is created: the object is written, read back to prove it arrived, and deleted before the response returns.</p>`,
    downstream:
      "<code>objectStorageRefs</code> → a <code>ServiceEntry</code> and egress entry per endpoint, plus the credential endpoints.",
    upstream: "Nothing. Cloud storage runs no sidecar, so gates 3 and 4 do not exist for it.",
    yaml: `# authorized-api — the caller
objectStorageRefs:
  - name: assets
# no consumes entry for the endpoint — the ref is the declaration`,
    istio: `# rendered from the ref alone
apiVersion: networking.istio.io/v1
kind: Sidecar
metadata:
  name: authorized-api
spec:
  egress:
    - hosts:
        - "istio-system/*"
        - "./rolesanywhere.us-east-1.amazonaws.com"  # credentials
        - "./sts.us-east-1.amazonaws.com"            # credentials
        - "./platform-platform-connections-demo-assets.s3.us-east-1.amazonaws.com"
        - "./s3.us-east-1.amazonaws.com"
# one ServiceEntry per host, all from one line of YAML`,
    sources: [
      { label: "authorized-api.yaml — the ref", url: `${WORKSPACES}/authorized-api.yaml` },
      { label: "assets.yaml — the bucket", url: `${WORKSPACES}/assets.yaml` },
      API_COMPOSITION,
    ],
  },
  {
    kind: "on-platform → off-platform",
    title: "The same holds for a database",
    grug:
      "Write an item, read it back, delete it. A different resource, a different endpoint, and again nothing was declared by hand.",
    call: {
      from: "authorized-api",
      to: "dynamodb.amazonaws.com",
      gate: "may I leave?",
      url: "/authorized/api/table",
      enforcedAt: "downstream",
      expect: 200,
      request: "PutItem → GetItem → DeleteItem",
      why: "<b>Allowed.</b> Same mechanism as the bucket, a different endpoint.",
    },
    deep: `<p>This is the previous case with one word changed, which is the point. Every managed resource the platform offers resolves to an endpoint it already knows, so none of them belong in <code>consumes</code>.</p>
<p>The rule that falls out: <b><code>consumes</code> is for what nothing else states.</b> An off-platform host nobody can infer, or an app in another namespace. Anything the platform provisioned for you, it can register for you — asking again would be asking for a fact it already holds.</p>
<p>The read uses a consistent read, so the item cannot come back missing from a stale replica. A demo that fails one time in twenty teaches the wrong lesson.</p>`,
    downstream: "<code>nosqlRef</code> → a <code>ServiceEntry</code> and egress entry for the database endpoint.",
    upstream: "Nothing. The database runs no sidecar either.",
    yaml: `# authorized-api — the caller
nosqlRef:
  name: records
# again no consumes entry`,
    istio: `apiVersion: networking.istio.io/v1
kind: ServiceEntry
metadata:
  name: authorized-api-dynamodb-us-east-1-amazonaws-com
spec:
  hosts:
    - "dynamodb.us-east-1.amazonaws.com"
  location: MESH_EXTERNAL
  resolution: DNS
  exportTo: ["."]
  ports:
    - number: 443
      name: tls
      protocol: TLS`,
    sources: [
      { label: "authorized-api.yaml — the ref", url: `${WORKSPACES}/authorized-api.yaml` },
      { label: "records.yaml — the table", url: `${WORKSPACES}/records.yaml` },
      API_COMPOSITION,
    ],
  },
  {
    kind: "where this stops",
    title: "Platform Connections stops at workload authorization",
    grug:
      "Every call above was decided by which pod was calling. Never by who was using it.",
    deep: `<p class="answers"><b>It answers</b></p>
<ul>
  <li>Can this workload call that workload?</li>
  <li>Can this workload reach this database?</li>
  <li>Can this workload use this bucket?</li>
</ul>
<p class="answers"><b>It does not answer</b></p>
<ul class="not">
  <li>Can Alice view Order 123?</li>
  <li>Can Bob approve payroll?</li>
</ul>
<p>Those last two are about a person and a particular record. Nothing here knows either — that is a separate layer, deliberately.</p>`,
    sources: [DESIGN_DOC],
  },
]
