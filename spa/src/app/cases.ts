/** A real file behind a snippet on the page. */
export interface Source {
  /** Shown in mono. The file the reader would open. */
  file: string
  /** What to look at once it opens. */
  note: string
  url: string
  /** Steers the link target, and the hover title. As a visible badge it competed with
   *  the filename for a line whose job is naming one file. */
  lines?: string
}

/** One file, or one rendered object. Never two of either in the same block. Stacked in
 *  a single box, a reader has to find the divider before knowing what they are reading. */
export interface Snippet {
  code: string
  sources: Source[]
  /** Whose pod this belongs to. Colours the block in that actor's hue, so a reader
   *  tracks ownership by sight instead of by counting rows across two columns. */
  actor?: "caller" | "callee"
}

export interface Case {
  kind: string
  title: string
  summary: string
  /** Absent on the closing card, which explains rather than calls. */
  call?: {
    from: string
    to: string
    gate: string
    url: string
    request: string
    /** Which pod's strip decides. The marker lands there, not mid-wire. */
    enforcedAt: "downstream" | "upstream"
    /** What does the deciding, so the strip is not labelled as the mesh when the
     *  mesh already said yes and application code is the thing refusing. */
    enforcedBy?: "mesh" | "app"
    /** What the mesh should answer. Anything else means the demo is not wired up. */
    expect: number
    /** Shown beside the status when the code alone would read as a broken demo. */
    codeNote?: string
    why: string
  }
  deep: string
  /** Why the callee column is empty. Only read when that pod renders nothing. */
  upstream?: string
  /** What the team writes, one block per file. */
  declared?: Snippet[]
  /** What the platform renders from it, one block per object. */
  rendered?: Snippet[]
  /** Standalone reading, for a card with no snippet to sit under. */
  docs?: Source[]
}

const WORKSPACES_SHA = "6500b37ffbf600201f2e59666b6a42daa9737dae"
const WORKSPACES = `https://github.com/cujarrett/homelab-workspaces/blob/${WORKSPACES_SHA}/platform-connections-demo`
const HOMELAB = "https://github.com/cujarrett/homelab/blob/main"

// Pinned to a commit, not to main. A line range on a moving branch drifts silently and
// eventually points at the wrong block; a permalink keeps pointing at the code that
// actually rendered the YAML above. Repin when the composition changes materially.
const COMPOSITION_SHA = "d928adcaf92a36caef431fa8ae2c6e1bdea4f878"
const COMPOSITION = `https://github.com/cujarrett/homelab/blob/${COMPOSITION_SHA}/platform/api/composition.yaml`

// GitHub wants the hyphen in the anchor; the badge shows an en dash.
function composition(note: string, from: number, to: number): Source {
  return {
    file: "platform/api/composition.yaml",
    note,
    lines: `L${from}–L${to}`,
    url: `${COMPOSITION}#L${from}-L${to}`,
  }
}

function workspace(file: string, note: string, from: number, to: number): Source {
  return {
    file,
    note,
    lines: `L${from}–L${to}`,
    url: `${WORKSPACES}/${file}#L${from}-L${to}`,
  }
}

const DESIGN_DOC: Source = {
  file: "docs/platform-connections.md",
  note: "the design and build plan behind all of this",
  url: `${HOMELAB}/docs/platform-connections.md`,
}
const NOTHING_NOVEL: Source = {
  file: "docs/nothing-novel.md",
  note: "every mechanism above, traced to the spec or vendor doc it came from",
  url: `${HOMELAB}/docs/nothing-novel.md`,
}
const CROSSPLANE_ADOPTERS: Source = {
  file: "crossplane/ADOPTERS.md",
  note: "Nike, SAP, Autodesk, Grafana Labs and Nokia, on the control plane this runs on",
  url: "https://github.com/crossplane/crossplane/blob/main/ADOPTERS.md",
}
const ISTIO_CASE_STUDIES: Source = {
  file: "istio.io/case-studies",
  note: "T-Mobile, eBay, Salesforce and Airbnb, on the mesh enforcing these calls",
  url: "https://istio.io/latest/about/case-studies/",
}

export const CASES: Case[] = [
  {
    kind: "service mesh · on-platform → on-platform",
    title: "Declared, so it works",
    summary:
      "Two declarations, one on each side: the caller's way out, the callee's guest list. The call works only because both are there.",
    call: {
      from: "authorized-api",
      to: "upstream-api",
      gate: "callee lets it in?",
      url: "/authorized/api/call",
      enforcedAt: "upstream",
      expect: 200,
      request: "GET upstream-api/api/v1/data",
      why: "<b>Allowed.</b> The caller's identity is named in the policy, so it passes.",
    },
    deep: `<p>This call needed two yeses: one from the caller's pod to let it out, one from the callee's pod to let it in. Sharing a namespace is neither.</p>
<p><b>Neither team wrote a service mesh policy.</b> One declared the calls it makes, the other declared who may call it. Neither has to know a service mesh exists, and that is the point. Platform engineering is the difference between understanding a mesh and shipping without needing to.</p>`,
    declared: [
      {
        code: `consumes:
  # ↓ lets the call out
  - namespace: platform-connections-demo
    app: upstream-api`,
        sources: [workspace("authorized-api.yaml", "the caller's way out", 25, 27)],
        actor: "caller",
      },
      {
        code: `provides:
  - name: data
    allowedCallers:
      # ↓ lets the call in
      - namespace: platform-connections-demo
        app: authorized-api`,
        sources: [workspace("upstream-api.yaml", "the callee's guest list", 24, 27)],
        actor: "callee",
      },
    ],
    rendered: [
      {
        code: `# the way out
apiVersion: networking.istio.io/v1
kind: Sidecar
metadata:
  name: authorized-api
spec:
  outboundTrafficPolicy:
    mode: REGISTRY_ONLY
  egress:
    - hosts:
        - "istio-system/*"   # istiod, where the sidecar gets its config and certs
        # ↓ the one app it declared. no wildcard, so nothing else
        - "platform-connections-demo/upstream-api.platform-connections-demo.svc.cluster.local"`,
        sources: [composition("the Sidecar egress list", 1011, 1054)],
        actor: "caller",
      },
      {
        code: `# the way in
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
              # no method or path limits, so the grant is the whole API`,
        sources: [composition("the AuthorizationPolicy template", 961, 1010)],
        actor: "callee",
      },
    ],
  },
  {
    kind: "service mesh · on-platform → on-platform",
    title: "Not declared, so it is refused",
    summary:
      "Same callee, same image, and it declared the same way out. It is missing from the callee's guest list, so it is turned away before the app ever sees it.",
    call: {
      from: "unauthorized-api",
      to: "upstream-api",
      gate: "callee lets it in?",
      url: "/unauthorized/api/call",
      enforcedAt: "upstream",
      expect: 403,
      request: "GET upstream-api/api/v1/data",
      why: "<b>Denied.</b> Nothing was wrong with the caller. It simply was not on the list.",
    },
    deep: `<p>upstream-api names one caller in its policy: authorized-api. unauthorized-api is not on the list so it is refused. The two callers are otherwise identical - same image, same declared way out. Only the guest list differs.</p>
<p><b>Could a pod claim to be someone else?</b> No. Identity is not a name in a header. Every meshed pod carries a certificate proving its SPIFFE identity, and STRICT mTLS refuses any peer that cannot present one. The name is checked only after the certificate proves it.</p>`,
    declared: [
      {
        code: `consumes:
  # ↓ the same line the last caller wrote, so it left its own pod fine
  - namespace: platform-connections-demo
    app: upstream-api`,
        sources: [
          workspace("unauthorized-api.yaml", "the caller, same image, same way out", 15, 16),
        ],
        actor: "caller",
      },
      {
        code: `provides:
  - name: data
    allowedCallers:
      - namespace: platform-connections-demo
        app: authorized-api
# unauthorized-api is absent, so it is denied`,
        sources: [workspace("upstream-api.yaml", "the guest list it is missing from", 24, 27)],
        actor: "callee",
      },
    ],
    rendered: [
      {
        code: `# no certificate, no conversation
apiVersion: security.istio.io/v1
kind: PeerAuthentication
metadata:
  name: upstream-api
spec:
  selector:
    matchLabels: { app.kubernetes.io/instance: upstream-api }
  mtls:
    mode: STRICT`,
        sources: [composition("the PeerAuthentication template", 937, 960)],
        actor: "callee",
      },
      {
        code: `# the guest list
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
# unauthorized-api appears in no rule, so it is refused`,
        sources: [composition("the AuthorizationPolicy template", 961, 1010)],
        actor: "callee",
      },
    ],
  },
  {
    kind: "service mesh · on-platform → off-platform",
    title: "A registered address works",
    summary:
      "The destination is on the internet now, outside the cluster and outside the mesh. The caller declared that one address, so the call goes out.",
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
    deep: `<p>One declared hostname renders both halves: a <code>ServiceEntry</code> to make the address known, and a <code>Sidecar</code> egress line to let this pod reach it. Known is not permitted.</p>`,
    upstream:
      "Nothing. The site checks no identity, so the mesh alone controls which workload may reach it.",
    declared: [
      {
        code: `consumes:
  - host: api.open-meteo.com
# declared, so this one is reachable`,
        sources: [workspace("authorized-api.yaml", "the declared host", 25, 26)],
        actor: "caller",
      },
    ],
    rendered: [
      {
        code: `# makes the address known
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
      protocol: TLS      # the app's own TLS passes straight through`,
        sources: [composition("the ServiceEntry per declared host", 1079, 1104)],
        actor: "caller",
      },
      {
        code: `# makes it this pod's to reach
apiVersion: networking.istio.io/v1
kind: Sidecar
metadata:
  name: authorized-api
spec:
  egress:
    - hosts:
        - "istio-system/*"   # istiod, where the sidecar gets its config and certs
        - "./api.open-meteo.com"   # known is not enough, this line permits it`,
        sources: [composition("the Sidecar egress list", 1011, 1054)],
        actor: "caller",
      },
    ],
  },
  {
    kind: "service mesh · on-platform → off-platform",
    title: "An unregistered address is refused",
    summary:
      "Same app, same internet, one call later. This address was never declared, so the request does not even leave the pod.",
    call: {
      from: "authorized-api",
      to: "example.com",
      gate: "may I leave?",
      url: "/authorized/api/leak",
      enforcedAt: "downstream",
      expect: 502,
      request: "GET https://example.com",
      codeNote: "its own sidecar answered, example.com was never contacted",
      why: "<b>Blocked on the way out.</b> The packet never reaches the internet.",
    },
    deep: `<p>There is no pod on the far end to hold a policy, so the only place to decide is the caller's own side, on the way out.</p>
<p>Its <code>Sidecar</code> runs <code>REGISTRY_ONLY</code>: the control plane, its own namespace, and the hosts it declared. Nothing else exists as far as it is concerned. No team asked for that default, and none can forget it.</p>`,
    upstream:
      "Nothing. It is a website on the internet, outside the mesh, and it never learns the call was attempted.",
    declared: [
      {
        code: `consumes:
  - host: api.open-meteo.com
# example.com is absent, so it is unreachable`,
        sources: [
          workspace(
            "authorized-api.yaml",
            "every host it declared, and example.com is not one",
            25,
            27,
          ),
        ],
        actor: "caller",
      },
    ],
    rendered: [
      {
        code: `apiVersion: networking.istio.io/v1
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
        - "istio-system/*"   # istiod, where the sidecar gets its config and certs
        - "./api.open-meteo.com"    # the one host it declared
# example.com is on no list, so there is nowhere to send it`,
        sources: [composition("REGISTRY_ONLY and the Sidecar egress list", 1011, 1054)],
        actor: "caller",
      },
    ],
  },
  {
    kind: "service mesh · on-platform → off-platform",
    title: "A bound resource declares itself",
    summary:
      "The app writes an item to a cloud database, reads it back, then deletes it. It never declared the address. Asking for the table was the declaration.",
    call: {
      from: "authorized-api",
      to: "dynamodb.amazonaws.com",
      gate: "may I leave?",
      url: "/authorized/api/table",
      enforcedAt: "downstream",
      expect: 200,
      request: "PutItem → GetItem → DeleteItem",
      why: "<b>Allowed.</b> The table reference is what opened the path to it.",
    },
    deep: `<p>Off-platform hosts normally go in <code>consumes</code>. This one does not. Asking for a table already identifies the endpoint, so the platform registers it.</p>
<p><b>There is a hidden call first.</b> Before touching the table, a sidecar trades this pod's certificate for temporary cloud credentials. Two more endpoints the app never declared, and unregistered means blackholed, so the platform registers those too. Miss them and the pod starts fine, then fails every call with nothing pointing at the mesh.</p>
<p>A bucket, a cache, a queue - every resource the platform hands out has an address it already knows, and the same thing happens. The rule that falls out: <b><code>consumes</code> is for what nothing else states.</b> An off-platform host nobody can infer, or an app in another namespace. Anything the platform provisioned, it registers.</p>`,
    upstream: "Nothing. The database is outside the mesh too.",
    declared: [
      {
        code: `nosqlRef:
  name: records
# no consumes entry for the endpoint, the ref is the declaration`,
        sources: [
          workspace("authorized-api.yaml", "the ref, which is the whole declaration", 18, 19),
          workspace("records.yaml", "the table it points at", 1, 8),
        ],
        actor: "caller",
      },
    ],
    rendered: [
      {
        code: `# nothing below was written by the app
apiVersion: networking.istio.io/v1
kind: Sidecar
metadata:
  name: authorized-api
spec:
  egress:
    - hosts:
        - "istio-system/*"
        # ↓ where the certificate is traded for credentials
        - "./sts.us-east-1.amazonaws.com"
        # ↓ every table in the region shares this one host
        - "./dynamodb.us-east-1.amazonaws.com"`,
        sources: [composition("the Sidecar egress list", 1011, 1054)],
        actor: "caller",
      },
      {
        code: `apiVersion: networking.istio.io/v1
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
        sources: [composition("the ServiceEntry per derived endpoint", 1055, 1078)],
        actor: "caller",
      },
    ],
  },
  {
    kind: "entra · on-platform → on-platform",
    title: "A second gate, answering to someone else",
    summary:
      "The same caller, the same callee, one route further on. The mesh lets it through exactly as before, and then the app asks a question the mesh never asked: was this identity granted the role?",
    call: {
      from: "authorized-api",
      to: "upstream-api",
      gate: "granted the role?",
      url: "/authorized/api/entra",
      enforcedAt: "upstream",
      enforcedBy: "app",
      expect: 200,
      request: "GET upstream-api/api/v1/protected",
      why: "<b>Allowed.</b> Every mesh gate passed, and the token carried Data.Read.",
    },
    deep: `<p>Nothing here replaces the mesh. The call still passes all four checkpoints first; only then is a token read. This gate can refuse a call the mesh allowed, and it can never permit one the mesh refused.</p>
<p><b>No secret is involved.</b> The pod already holds a certificate proving which workload it is. It presents that to Entra, which trusts it because the callee's registration was told to, and gets back a token naming the roles it holds. Nothing is stored, and there is no password to rotate.</p>
<p><b>Why bother, when the mesh already said yes?</b> The mesh answers "may this workload open a connection". This answers "may this identity do this particular thing", and it answers it somewhere outside the cluster - so the grant survives the cluster and holds anywhere that identity is used.</p>`,
    declared: [
      {
        code: `entra:
  enabled: true
# an identity, and nothing else. it grants nothing`,
        sources: [workspace("authorized-api.yaml", "the caller asks only for an identity", 12, 13)],
        actor: "caller",
      },
      {
        code: `entra:
  enabled: true
  roles:
    - name: Data.Read
      allowedCallers:
        - namespace: platform-connections-demo
          app: authorized-api`,
        sources: [workspace("upstream-api.yaml", "the callee declares the role, and who holds it", 13, 18)],
        actor: "callee",
      },
    ],
    rendered: [
      {
        code: `# the role this API offers
apiVersion: applications.azuread.upbound.io/v1beta1
kind: AppRole
metadata:
  name: platform-connections-demo-upstream-api-entra-role-data-read
spec:
  forProvider:
    value: Data.Read
    # not User - there is no person behind this call
    allowedMemberTypes: ["Application"]`,
        sources: [composition("the AppRole template", 746, 768)],
        actor: "callee",
      },
      {
        code: `# the grant itself, one per allowed caller
apiVersion: app.azuread.upbound.io/v1beta1
kind: RoleAssignment
metadata:
  name: platform-connections-demo-upstream-api-entra-grant-data-read-platform-connections-demo-authorized-api
spec:
  forProvider:
    principalObjectIdRef:
      name: platform-connections-demo-authorized-api-entra
    resourceObjectIdRef:
      name: platform-connections-demo-upstream-api-entra`,
        sources: [composition("the RoleAssignment template", 769, 795)],
        actor: "callee",
      },
    ],
  },
  {
    kind: "entra · on-platform → on-platform",
    title: "The same caller, refused one route later",
    summary:
      "This is the caller you just watched succeed. Same identity, same certificate, same guest list, one route further on. It is turned away by something the mesh had no part in.",
    call: {
      from: "authorized-api",
      to: "upstream-api",
      gate: "granted the role?",
      url: "/authorized/api/entra-admin",
      enforcedAt: "upstream",
      enforcedBy: "app",
      expect: 403,
      codeNote: "refused by the app, not the proxy",
      request: "GET upstream-api/api/v1/admin",
      why: "<b>Denied.</b> Allowed in, and still not allowed to do this.",
    },
    deep: `<p>Nothing changed about the caller between these two cards. It passed every mesh gate here exactly as it did there, and its token is the same real, signed, unexpired token. That token names one role, and this route wants a different one: <code>identity is valid but holds ["Data.Read"], needs "Data.Admin"</code>.</p>
<p><b>Being let in is not being allowed to do everything.</b> The mesh answers once, at the door, for the whole workload. This answers per route, so one caller can read and not administer. Splitting that would take a second app and a second guest list at the mesh layer.</p>
<p><b>Two 403s that look identical and are not.</b> The refusal two cards up came from a proxy reading a certificate. This one came from application code reading a claim. They live in different files, in different systems, and are fixed by different people - so the response says which gate answered.</p>`,
    declared: [
      {
        code: `entra:
  enabled: true
# unchanged. the caller asks for nothing route-specific`,
        sources: [workspace("authorized-api.yaml", "the same two lines as the card above", 12, 13)],
        actor: "caller",
      },
      {
        code: `roles:
  - name: Data.Read
    allowedCallers:
      - namespace: platform-connections-demo
        app: authorized-api
  # offered, and held by nobody
  - name: Data.Admin
    allowedCallers: []`,
        sources: [workspace("upstream-api.yaml", "two roles, one grant", 13, 22)],
        actor: "callee",
      },
    ],
    rendered: [
      {
        code: `# both roles exist on the registration
apiVersion: applications.azuread.upbound.io/v1beta1
kind: AppRole
spec:
  forProvider:
    value: Data.Admin
    allowedMemberTypes: ["Application"]`,
        sources: [composition("one AppRole per declared role", 746, 768)],
        actor: "callee",
      },
      {
        code: `# one RoleAssignment, for Data.Read only.
# there is no object granting Data.Admin - that absence is the refusal
apiVersion: app.azuread.upbound.io/v1beta1
kind: RoleAssignment
spec:
  forProvider:
    principalObjectIdRef:
      name: platform-connections-demo-authorized-api-entra`,
        sources: [composition("one grant per allowed caller, and no more", 769, 795)],
        actor: "callee",
      },
    ],
  },
  {
    kind: "where this stops",
    title: "Platform Connections stops at workload authorization",
    summary: "Every call above was decided by which pod was calling. Never by who was using it.",
    deep: `<p class="answers"><b>It answers</b></p>
<ul>
  <li>Can this pod call that pod?</li>
  <li>Can this pod reach this database?</li>
  <li>Can this pod use this bucket?</li>
</ul>
<p class="answers"><b>It does not answer</b></p>
<ul class="not">
  <li>Can Alice view Order 123?</li>
  <li>Can Bob approve payroll?</li>
</ul>
<p>Those last two are about a person and a particular record.</p>
<hr class="close-rule" />
<p><b>A mesh can already watch every call. So why declare?</b> Watching only shows what happened while something was looking, so the quarter-end job and the failover path are missing from that graph and live in production. Declaring costs a line in review. <i>Can we turn this off?</i> becomes a list of who declared it, not thirty days of silence, and an undeclared call is refused as it happens, not drawn on a dashboard for Monday.</p>`,
    docs: [DESIGN_DOC, NOTHING_NOVEL, CROSSPLANE_ADOPTERS, ISTIO_CASE_STUDIES],
  },
]
