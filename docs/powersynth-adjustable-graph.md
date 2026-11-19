# PowerSynth adjustable-layout graph

This is one explicit **object-level, undirected relation graph** for the four-input PowerSynth design example. It is constructed from the layout; it is not the solver's internal PEEC graph. It includes the five objects whose geometry changes, and it uses fixed topology. The fixed components and the rest of the current path are omitted.

Node order throughout: **T1** (DC− bar), **T2** (SW shelf), **T3** (SW spine), **D1**, **D2** (low-side dies).

## Independent variables

All dimensions are in mm. At the reference geometry, `(w, g, h, d) = (10, 2, 6, 0)`.

| Symbol | Control | Range |
|---|---|---:|
| `w` | T3 spine width | 7–13 |
| `g` | Clearance between T1 and T2 | 0.5–2.5 |
| `h` | In-plane T1 bar height | 4.75–6 |
| `d` | Common D1/D2 x-offset | −0.75–0.75 |

For `y₀ = 2 + h + g`, the actual rectangles `(x, y, width, height)` are `T1=(2,2,40,h)`, `T2=(2,y₀,40−w,18−y₀)`, `T3=(42−w,y₀,w,42−y₀)`, `D1=(8+d,y₀+1,4,6)`, and `D2=(17+d,y₀+1,4,6)`. Constants belong to the fixed reference template and are not extra controls.

## Adjacency and features

The edge T1–T2 records a **nonconductive clearance**, T2–T3 is shared SW copper, T2–D1 and T2–D2 are die-to-shelf contacts, and T1–D1 and T1–D2 represent source bond wires BW3 and BW4. Edge types must be retained separately: a `1` in the following binary adjacency does **not** always mean electrical contact.

```text
          T1 T2 T3 D1 D2
A = T1 [  0  1  0  1  1 ]
    T2 [  1  0  1  1  1 ]
    T3 [  0  1  0  0  0 ]
    D1 [  1  1  0  0  0 ]
    D2 [  1  1  0  0  0 ]
```

Use node features `X` as changes in `(x, y, width, height)` relative to the reference rectangles. This records only adjustable geometry rather than fixed dimensions. Let `z = h + g − 8` and `t = 10 − w`:

```text
          Δx  Δy  Δwidth  Δheight
X = T1 [  0    0     0      h−6 ]
    T2 [  0    z     t       −z ]
    T3 [  t    z    −t       −z ]
    D1 [  d    z     0        0 ]
    D2 [  d    z     0        0 ]
```

The single explicit edge feature is the clearance `g`, stored in a symmetric edge-feature matrix `G`; other zeros mean “no clearance feature assigned,” not a measured zero gap. Edge types and a feature mask are required to distinguish missing features from zero-valued features.

```text
          T1 T2 T3 D1 D2
G = T1 [  0  g  0  0  0 ]
    T2 [  g  0  0  0  0 ]
    T3 [  0  0  0  0  0 ]
    D1 [  0  0  0  0  0 ]
    D2 [  0  0  0  0  0 ]
```

Other edge geometry, such as changing wire shape, is not explicitly encoded in `G`; the four controls and the fixed layout template can be used to reconstruct the parameterized geometry. This is not a complete physical graph.

## Concatenation and analysis

One possible row-wise representation is `M = [A | X | G]`, a **5 × 14** matrix:

```text
T1 [ 0 1 0 1 1 | 0 0  0 h−6 | 0 g 0 0 0 ]
T2 [ 1 0 1 1 1 | 0 z  t  −z | g 0 0 0 0 ]
T3 [ 0 1 0 0 0 | t z −t  −z | 0 0 0 0 0 ]
D1 [ 1 1 0 0 0 | d z  0   0 | 0 0 0 0 0 ]
D2 [ 1 1 0 0 0 | d z  0   0 | 0 0 0 0 0 ]
```

At the reference geometry `z=t=d=0`, so `X` is zero; `G₁₂=G₂₁=2 mm`. `A` is fixed for every one of the 256 sampled layouts. It contains six undirected edges, has degrees `(3,4,1,2,2)`, and has rank 4. Because the D1 and D2 rows are identical, `M` has at most rank 4; because it contains rank-4 `A`, its row rank is exactly 4 for every allowed configuration.

Matrix rank is not generally a count of physical controls. Here the **parameter-to-feature mapping** has four independent degrees of freedom: `h=6+X₁₄`, `g=G₁₂`, `w=10−X₂₃`, and `d=X₄₁`. Several values repeat: `z` appears in four node rows, and `g` is also recoverable from node geometry. This redundancy can help describe relations but does not create additional design variables.

D1 and D2 are indistinguishable in this particular feature matrix, even though their fixed x coordinates differ by 9 mm. Keep the reference template and node identity, or add fixed positional/type features, if an application needs to distinguish them. The graph and feature mask also need relation types. `A` is dimensionless while `X` and `G` are in millimetres, so normalize feature groups before learning; padding with zero alone is not a suitable missing-value convention. Flattening adjacency depends on node ordering and is not permutation invariant.

The currently deployed model is a **4 → 64 → 64 → 1 MLP** receiving `(w, g, h, d)` directly; it does not use this concatenation or a graph neural network. Its output is a surrogate for reduced-PEEC loop inductance at 100 kHz between L5.P and L1.P. Inductance involves the complete conductor geometry and nonlocal coupling, so it cannot be inferred from the simplified adjacency or its rank alone. For the solver's assumptions and validation, see [the model record](design-nn-4d-model.md).
