"""
trader_vwap_hf.py
HP = VWAP mean-reversion (WIN=20, K=0.75).
VE + VEV_4000 = Hedge Follower (mirrors structural delta demand from bot short-option positions).
All options logic (Wings, ITM, MIDS, Orin residual) unchanged from trader_vwap.py.

State serialized with json (flat dict).
"""
import json
from math import erf, log, sqrt
from typing import Any, Dict, List, Optional, Tuple

from datamodel import Order, OrderDepth, TradingState


HYDROGEL = "HYDROGEL_PACK"
VELVET = "VELVETFRUIT_EXTRACT"

VEV_4K = "VEV_4000"
WINGS = ["VEV_6000", "VEV_6500"]

ITM = ["VEV_4500", "VEV_5100"]
MIDS = ["VEV_5300", "VEV_5400", "VEV_5500"]
ORIN_PRODUCTS = ["VEV_5000", "VEV_5200"]

FIT_PRODUCTS = ["VEV_5000", "VEV_5100", "VEV_5200", "VEV_5300", "VEV_5400", "VEV_5500"]
NTM_PRODUCTS = ["VEV_5200", "VEV_5300", "VEV_5400"]

STRIKES = {
    "VEV_4500": 4500, "VEV_5000": 5000, "VEV_5100": 5100, "VEV_5200": 5200,
    "VEV_5300": 5300, "VEV_5400": 5400, "VEV_5500": 5500,
    "VEV_6000": 6000, "VEV_6500": 6500,
}

ALL_PRODUCTS = [
    HYDROGEL, VELVET, VEV_4K,
    "VEV_4500", "VEV_5000", "VEV_5100", "VEV_5200",
    "VEV_5300", "VEV_5400", "VEV_5500", "VEV_6000", "VEV_6500",
]

# ── HP VWAP parameters (best OOS: WIN=20, K=0.75 → PnL=10,151) ───────────────
HP_VWAP_WIN = 20
HP_VWAP_K   = 0.75
HP_QTY      = 10
HP_LIM      = 200

# ── VE / VEV limits ───────────────────────────────────────────────────────────
TOTAL_LIMIT = 200
VEV_LIMIT   = 300
MM_LIMIT    = 100

# ── VEV_4000 structural MM (kept for Wings/ITM/MIDS constants reference) ──────
VEV4K_MAX    = 150
VEV4K_STEP   = 20
VEV4K_UNWIND = 50

# ── Wings ─────────────────────────────────────────────────────────────────────
WING_MAX  = 300
WING_STEP = 30

# ── ITM ───────────────────────────────────────────────────────────────────────
ITM_MAX  = 25
ITM_STEP = 8

# ── MIDS ──────────────────────────────────────────────────────────────────────
MID_MAX = {"VEV_5300": 100, "VEV_5400": 5, "VEV_5500": 3}
MID_SELL_ONLY = {"VEV_5400", "VEV_5500"}
MID_STEP = 15

# ── Orin residual ─────────────────────────────────────────────────────────────
LIMIT           = 300
TTE_DAYS        = 5.0
LOOKBACK        = 300
MIN_PERIODS     = 100
RESID_HISTORY_LEN = 350
RV_WINDOW       = 300
RV_MIN_PERIODS  = 100
SCALE_WINDOW    = 500
SCALE_MIN_PERIODS = 100
ORDER_STEP      = 20
QUOTE_IMPROVE   = 1

ENTRY_Z_1 = -1.5
ENTRY_Z_2 = -2.0
ENTRY_Z_3 = -2.5
EXIT_Z    = -0.3

TARGET_1 = 40
TARGET_2 = 80
TARGET_3 = 120

# ── Hedge Follower params ─────────────────────────────────────────────────────
HF_IV_SYM        = "VEV_5300"
HF_VE_SCALE      = 0.9
HF_MAX_VE_LONG   = 200
HF_REBAL_BAND    = 15
HF_TRACK_SYMS    = ["VEV_5300", "VEV_5400", "VEV_5500"]
HF_USE_4K        = True
HF_MAX_4K_LONG   = 100
HF_REBAL_BAND_4K = 10
HF_DELTA_MIN_4K  = 0.90
HF_VEV_STRIKES   = {"VEV_5300": 5300, "VEV_5400": 5400, "VEV_5500": 5500}
_HF_MAX_TS       = 1_000_000.0


# ── Helpers ───────────────────────────────────────────────────────────────────

def best_bid(od: OrderDepth) -> Optional[Tuple[int, int]]:
    if not od.buy_orders:
        return None
    p = max(od.buy_orders)
    return p, abs(od.buy_orders[p])


def best_ask(od: OrderDepth) -> Optional[Tuple[int, int]]:
    if not od.sell_orders:
        return None
    p = min(od.sell_orders)
    return p, abs(od.sell_orders[p])


def mid_price(od: OrderDepth) -> Optional[float]:
    bid = best_bid(od)
    ask = best_ask(od)
    if bid is None or ask is None:
        return None
    return (bid[0] + ask[0]) / 2.0


def book_vwap_mid(od: OrderDepth, levels: int = 3) -> Optional[float]:
    if not od.buy_orders or not od.sell_orders:
        return None
    bids = sorted(od.buy_orders.items(), key=lambda x: x[0], reverse=True)[:levels]
    asks = sorted(od.sell_orders.items(), key=lambda x: x[0])[:levels]
    bid_pv = bid_q = ask_pv = ask_q = 0.0
    for price, qty in bids:
        q = abs(qty)
        bid_pv += price * q; bid_q += q
    for price, qty in asks:
        q = abs(qty)
        ask_pv += price * q; ask_q += q
    if bid_q <= 0 or ask_q <= 0:
        return None
    return (bid_pv / bid_q + ask_pv / ask_q) / 2.0


def avg(values: List[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def median(values: List[float]) -> float:
    if not values:
        return 0.0
    s = sorted(values)
    n = len(s); m = n // 2
    return s[m] if n % 2 == 1 else 0.5 * (s[m - 1] + s[m])


def std(values: List[float]) -> float:
    if len(values) < 2:
        return 0.0
    m = avg(values)
    return sqrt(sum((x - m) ** 2 for x in values) / len(values))


def clamp(x: int, lo: int, hi: int) -> int:
    return max(lo, min(hi, x))


def norm_cdf(x: float) -> float:
    return 0.5 * (1.0 + erf(x / sqrt(2.0)))


def bs_call_price(S: float, K: float, T: float, sigma: float) -> float:
    if S <= 0 or K <= 0 or T <= 0:
        return 0.0
    intrinsic = max(S - K, 0.0)
    if sigma <= 1e-9:
        return intrinsic
    vst = sigma * sqrt(T)
    if vst <= 1e-12:
        return intrinsic
    d1 = (log(S / K) + 0.5 * sigma * sigma * T) / vst
    return S * norm_cdf(d1) - K * norm_cdf(d1 - vst)


def implied_vol_call(price, S, K, T, lo=1e-6, hi=5.0, n_iter=45):
    intrinsic = max(S - K, 0.0)
    if price < intrinsic - 1e-9 or price > S + 1e-9:
        return None
    if price > bs_call_price(S, K, T, hi):
        return None
    for _ in range(n_iter):
        mid_s = (lo + hi) / 2.0
        if bs_call_price(S, K, T, mid_s) < price:
            lo = mid_s
        else:
            hi = mid_s
    return (lo + hi) / 2.0


def solve_3x3(A, b):
    M = [[A[i][j] for j in range(3)] + [b[i]] for i in range(3)]
    for col in range(3):
        pivot = max(range(col, 3), key=lambda r: abs(M[r][col]))
        if abs(M[pivot][col]) < 1e-12:
            return None
        if pivot != col:
            M[col], M[pivot] = M[pivot], M[col]
        d = M[col][col]
        M[col] = [v / d for v in M[col]]
        for r in range(3):
            if r != col:
                f = M[r][col]
                M[r] = [M[r][j] - f * M[col][j] for j in range(4)]
    return M[0][3], M[1][3], M[2][3]


def fit_quadratic(xs, ys):
    if len(xs) < 5:
        return None
    n = float(len(xs))
    s1 = sum(xs); s2 = sum(x*x for x in xs)
    s3 = sum(x**3 for x in xs); s4 = sum(x**4 for x in xs)
    t0 = sum(ys); t1 = sum(x*y for x, y in zip(xs, ys))
    t2 = sum(x*x*y for x, y in zip(xs, ys))
    return solve_3x3([[s4,s3,s2],[s3,s2,s1],[s2,s1,n]], [t2,t1,t0])


def quad_value(coef, x):
    a, b, c = coef
    return a*x*x + b*x + c


def obi(od: OrderDepth) -> float:
    bid = best_bid(od)
    ask = best_ask(od)
    if bid is None or ask is None:
        return 0.0
    _, bv = bid; _, av = ask
    denom = bv + av
    return (bv - av) / denom if denom > 0 else 0.0


# ── Hedge Follower module-level helpers ───────────────────────────────────────

def _hf_tte(day_idx: int, timestamp: int) -> float:
    days_left = (8 - day_idx) - timestamp / _HF_MAX_TS
    return max(days_left / 365.0, 1e-6)

def _hf_bs_delta(S: float, K: float, T: float, sigma: float) -> float:
    if S <= 0 or K <= 0 or T <= 0 or sigma <= 0:
        return 1.0 if S > K else 0.0
    vst = sigma * sqrt(T)
    d1  = (log(S / K) + 0.5 * sigma * sigma * T) / vst
    return norm_cdf(d1)

def _hf_implied_vol(price: float, S: float, K: float, T: float) -> float:
    intrinsic = max(S - K, 0.0)
    if price <= intrinsic + 1e-8 or S <= 0 or K <= 0 or T <= 0:
        return float('nan')
    sigma = 0.3
    for _ in range(50):
        c    = bs_call_price(S, K, T, sigma)
        vst  = sigma * sqrt(T)
        d1   = (log(S / K) + 0.5 * sigma * sigma * T) / vst
        vega = S * (2.71828 ** (-0.5 * d1 * d1)) / (2.5066 * sqrt(T))
        if vega < 1e-10:
            return float('nan')
        sigma -= (c - price) / vega
        if sigma <= 0:
            return float('nan')
        if abs(c - price) < 1e-6:
            break
    return sigma if sigma > 0 else float('nan')


# ── Trader ────────────────────────────────────────────────────────────────────

class Trader:
    def run(self, state: TradingState):
        try:
            data: Dict[str, Any] = json.loads(state.traderData) if state.traderData else {}
        except Exception:
            data = {}

        orders: Dict[str, List[Order]] = {p: [] for p in ALL_PRODUCTS}
        conversions = 0

        # ====================================================================
        # 1) HYDROGEL — VWAP mean-reversion
        # ====================================================================
        h_depth = state.order_depths.get(HYDROGEL)
        if h_depth is not None:
            bb_h = max(h_depth.buy_orders)  if h_depth.buy_orders  else None
            aa_h = min(h_depth.sell_orders) if h_depth.sell_orders else None
            if bb_h is not None and aa_h is not None:
                mid_h     = (bb_h + aa_h) / 2.0
                vol_proxy = abs(h_depth.buy_orders.get(bb_h, 1))
                if vol_proxy <= 0:
                    vol_proxy = 1

                cum_pv  = float(data.get('hp_cum_pv', 0.0))
                cum_v   = float(data.get('hp_cum_v',  0.0))
                hp_devs = data.get('hp_devs', [])
                if not isinstance(hp_devs, list):
                    hp_devs = []

                cum_pv += mid_h * vol_proxy
                cum_v  += vol_proxy
                vwap    = cum_pv / cum_v
                dev     = mid_h - vwap

                hp_devs.append(dev)
                if len(hp_devs) > HP_VWAP_WIN:
                    hp_devs = hp_devs[-HP_VWAP_WIN:]

                data['hp_cum_pv'] = cum_pv
                data['hp_cum_v']  = cum_v
                data['hp_devs']   = hp_devs

                if len(hp_devs) >= HP_VWAP_WIN:
                    hp_sig = std(hp_devs)
                    if hp_sig > 1e-9:
                        z   = dev / hp_sig
                        pos = state.position.get(HYDROGEL, 0)

                        if z < -HP_VWAP_K and pos < HP_LIM:
                            qty = min(HP_QTY, HP_LIM - pos)
                            if qty > 0:
                                orders[HYDROGEL].append(Order(HYDROGEL, bb_h, qty))

                        elif z > HP_VWAP_K and pos > -HP_LIM:
                            qty = min(HP_QTY, HP_LIM + pos)
                            if qty > 0:
                                orders[HYDROGEL].append(Order(HYDROGEL, aa_h, -qty))

                        elif abs(dev) < 0.1 * hp_sig and pos != 0:
                            if pos > 0:
                                orders[HYDROGEL].append(Order(HYDROGEL, aa_h, -pos))
                            else:
                                orders[HYDROGEL].append(Order(HYDROGEL, bb_h, -pos))

        # ====================================================================
        # 2) VELVET EXTRACT + VEV_4000 — Hedge Follower
        # ====================================================================
        # Day detection
        hf_tc = int(data.get('hf_tc', 0))
        hf_di = int(data.get('hf_di', 0))
        hf_lt = int(data.get('hf_lt', -1))
        if hf_tc > 0 and state.timestamp < hf_lt:
            hf_di += 1

        ve_depth = state.order_depths.get(VELVET)
        if ve_depth is not None:
            spot = mid_price(ve_depth)
            if spot is not None:
                tte = _hf_tte(hf_di, state.timestamp)

                # IV inference
                hf_last_iv = float(data.get('hf_iv', 0.22))
                iv_depth   = state.order_depths.get(HF_IV_SYM)
                sigma_hf   = hf_last_iv
                if iv_depth is not None:
                    iv_opt_mid = mid_price(iv_depth)
                    if iv_opt_mid is not None and iv_opt_mid > 0:
                        iv_inf = _hf_implied_vol(iv_opt_mid, spot, 5300, tte)
                        if iv_inf == iv_inf and 0.01 < iv_inf < 5.0:  # not nan
                            sigma_hf = iv_inf

                # Accumulate bot short estimates
                hf_Q = {sym: float(data.get(f'hf_Q_{sym}', 0.0)) for sym in HF_TRACK_SYMS}
                for sym in HF_TRACK_SYMS:
                    sym_depth = state.order_depths.get(sym)
                    if sym_depth is None or not sym_depth.buy_orders:
                        continue
                    bid_px = max(sym_depth.buy_orders)
                    for trade in state.market_trades.get(sym, []):
                        if trade.price <= bid_px + 0.5:
                            hf_Q[sym] += trade.quantity

                # Total delta demand
                delta_demand = sum(
                    hf_Q[sym] * _hf_bs_delta(spot, HF_VEV_STRIKES[sym], tte, sigma_hf)
                    for sym in HF_TRACK_SYMS
                )
                raw_target = max(HF_VE_SCALE * delta_demand, 0.0)

                # VE leg: absorb up to HF_MAX_VE_LONG
                target_ve = int(round(min(raw_target, HF_MAX_VE_LONG, TOTAL_LIMIT)))
                ve_pos    = state.position.get(VELVET, 0)
                diff_ve   = target_ve - ve_pos

                if abs(diff_ve) >= HF_REBAL_BAND:
                    b_ve = best_bid(ve_depth)
                    a_ve = best_ask(ve_depth)
                    if diff_ve > 0 and a_ve is not None:
                        qty = min(diff_ve, a_ve[1])
                        if qty > 0:
                            orders[VELVET].append(Order(VELVET, a_ve[0], qty))
                    elif diff_ve < 0 and b_ve is not None:
                        qty = max(diff_ve, -b_ve[1])
                        if qty < 0:
                            orders[VELVET].append(Order(VELVET, b_ve[0], qty))

                # VEV_4000 leg: absorb overflow
                if HF_USE_4K:
                    delta_4k = _hf_bs_delta(spot, 4000, tte, sigma_hf)
                    od_4k    = state.order_depths.get(VEV_4K)
                    if delta_4k >= HF_DELTA_MIN_4K:
                        overflow  = max(raw_target - HF_MAX_VE_LONG, 0.0)
                        target_4k = int(round(min(overflow, HF_MAX_4K_LONG, VEV_LIMIT)))
                        p_4k      = state.position.get(VEV_4K, 0)
                        diff_4k   = target_4k - p_4k

                        if abs(diff_4k) >= HF_REBAL_BAND_4K and od_4k is not None:
                            b4k = best_bid(od_4k)
                            a4k = best_ask(od_4k)
                            if diff_4k > 0 and b4k is not None:          # passive buy at bid
                                qty = min(diff_4k, b4k[1])
                                if qty > 0:
                                    orders[VEV_4K].append(Order(VEV_4K, b4k[0], qty))
                            elif diff_4k < 0 and a4k is not None:         # passive sell at ask
                                qty = max(diff_4k, -a4k[1])
                                if qty < 0:
                                    orders[VEV_4K].append(Order(VEV_4K, a4k[0], qty))
                    else:
                        # Delta too low — unwind 4K
                        p_4k = state.position.get(VEV_4K, 0)
                        if p_4k > 0 and od_4k is not None:
                            b4k = best_bid(od_4k)
                            if b4k is not None:
                                qty = max(-p_4k, -b4k[1])
                                if qty < 0:
                                    orders[VEV_4K].append(Order(VEV_4K, b4k[0], qty))

                # Save HF state
                data['hf_iv'] = sigma_hf
                data['hf_di'] = hf_di
                data['hf_tc'] = hf_tc + 1
                data['hf_lt'] = state.timestamp
                for sym in HF_TRACK_SYMS:
                    data[f'hf_Q_{sym}'] = hf_Q[sym]

        # ====================================================================
        # 4) WINGS — bid at zero
        # ====================================================================
        for product in WINGS:
            od = state.order_depths.get(product)
            if od is None:
                continue
            bid = best_bid(od)
            if bid is None:
                continue
            bp, bv = bid
            pos = state.position.get(product, 0)
            if bp == 0 and pos < WING_MAX:
                qty = min(VEV_LIMIT - pos, WING_MAX - pos, WING_STEP, bv)
                if qty > 0:
                    orders[product].append(Order(product, 0, qty))

        # ====================================================================
        # 5) ITM MM
        # ====================================================================
        for product in ITM:
            od = state.order_depths.get(product)
            if od is None:
                continue
            bid = best_bid(od); ask = best_ask(od)
            if bid is None or ask is None:
                continue
            bp, bv = bid; ap, av = ask
            pos = state.position.get(product, 0)
            my_bid = bp + 1; my_ask = ap - 1
            if my_bid < my_ask:
                if pos < ITM_MAX:
                    qty = min(VEV_LIMIT - pos, ITM_MAX - pos, ITM_STEP, bv)
                    if qty > 0:
                        orders[product].append(Order(product, my_bid, qty))
                if pos > -ITM_MAX:
                    qty = min(VEV_LIMIT + pos, ITM_MAX + pos, ITM_STEP, av)
                    if qty > 0:
                        orders[product].append(Order(product, my_ask, -qty))

        # ====================================================================
        # 6) MIDS MM
        # ====================================================================
        for product in MIDS:
            od = state.order_depths.get(product)
            if od is None:
                continue
            bid = best_bid(od); ask = best_ask(od)
            if bid is None or ask is None:
                continue
            bp, bv = bid; ap, av = ask
            pos = state.position.get(product, 0)
            cap = MID_MAX[product]
            my_bid = bp + 1; my_ask = ap - 1
            if my_bid < ap and pos < cap and product not in MID_SELL_ONLY:
                qty = min(VEV_LIMIT - pos, cap - pos, MID_STEP, bv)
                if qty > 0:
                    orders[product].append(Order(product, my_bid, qty))
            if my_ask > bp and pos > -cap:
                qty = min(VEV_LIMIT + pos, cap + pos, MID_STEP, av)
                if qty > 0:
                    orders[product].append(Order(product, my_ask, -qty))

        # ====================================================================
        # 7) ORIN residual on VEV_5000 / VEV_5200 — no hedge
        # ====================================================================
        underlying_depth = state.order_depths.get(VELVET)
        if underlying_depth is not None:
            S = book_vwap_mid(underlying_depth)
            if S is not None:
                s_hist = data.get('S_hist', [])
                if not isinstance(s_hist, list):
                    s_hist = []
                s_hist = (s_hist + [S])[-(RV_WINDOW + 5):]
                data['S_hist'] = s_hist

                rv_raw = None
                if len(s_hist) >= RV_MIN_PERIODS + 1:
                    rets = [log(s_hist[i] / s_hist[i-1])
                            for i in range(1, len(s_hist))
                            if s_hist[i-1] > 0 and s_hist[i] > 0]
                    if len(rets) >= RV_MIN_PERIODS:
                        rv_raw = std(rets[-RV_WINDOW:])

                xs: List[float] = []; ys: List[float] = []
                iv_info: Dict[str, Dict] = {}

                for product in FIT_PRODUCTS:
                    depth = state.order_depths.get(product)
                    if depth is None:
                        continue
                    opt_mid = book_vwap_mid(depth)
                    if opt_mid is None:
                        continue
                    K = STRIKES[product]
                    iv = implied_vol_call(opt_mid, S, K, TTE_DAYS)
                    if iv is None or iv < 0.005:
                        continue
                    m = log(K / S) / sqrt(TTE_DAYS)
                    xs.append(m); ys.append(iv)
                    iv_info[product] = {'iv': iv, 'm': m}

                coef = fit_quadratic(xs, ys)

                if coef is not None:
                    ntm_ivs = [iv_info[p]['iv'] for p in NTM_PRODUCTS if p in iv_info]
                    avg_ntm_iv = avg(ntm_ivs) if ntm_ivs else None
                    iv_rv = None

                    if avg_ntm_iv is not None and rv_raw is not None and rv_raw > 1e-12:
                        avg_iv_hist = data.get('avg_iv_hist', [])
                        rv_hist     = data.get('rv_hist', [])
                        if not isinstance(avg_iv_hist, list): avg_iv_hist = []
                        if not isinstance(rv_hist, list):     rv_hist = []
                        avg_iv_hist = (avg_iv_hist + [avg_ntm_iv])[-SCALE_WINDOW:]
                        rv_hist     = (rv_hist + [rv_raw])[-SCALE_WINDOW:]
                        data['avg_iv_hist'] = avg_iv_hist
                        data['rv_hist']     = rv_hist

                        if len(avg_iv_hist) >= SCALE_MIN_PERIODS and len(rv_hist) >= SCALE_MIN_PERIODS:
                            scale  = median(avg_iv_hist) / median(rv_hist)
                            iv_rv  = avg_ntm_iv - rv_raw * scale

                    for product in ORIN_PRODUCTS:
                        if product not in iv_info:
                            continue
                        depth = state.order_depths.get(product)
                        if depth is None:
                            continue
                        iv = iv_info[product]['iv']
                        m  = iv_info[product]['m']
                        fitted_iv = quad_value(coef, m)
                        resid     = iv - fitted_iv

                        hist_key   = f'resid_hist_{product}'
                        resid_hist = data.get(hist_key, [])
                        if not isinstance(resid_hist, list): resid_hist = []
                        resid_hist = (resid_hist + [resid])[-RESID_HISTORY_LEN:]
                        data[hist_key] = resid_hist

                        target_pos = int(data.get(f'target_{product}', 0))
                        resid_z    = 0.0

                        if len(resid_hist) >= MIN_PERIODS:
                            window = resid_hist[-LOOKBACK:]
                            s_val  = std(window)
                            if s_val > 1e-12:
                                resid_z = (resid - avg(window)) / s_val

                            allow_entry = iv_rv is not None and iv_rv < 0
                            if allow_entry:
                                if resid_z < ENTRY_Z_3:   target_pos = TARGET_3
                                elif resid_z < ENTRY_Z_2: target_pos = TARGET_2
                                elif resid_z < ENTRY_Z_1: target_pos = TARGET_1
                            if resid_z > EXIT_Z:
                                target_pos = 0

                        target_pos = clamp(target_pos, -LIMIT, LIMIT)
                        data[f'target_{product}'] = target_pos

                        orders[product].extend(
                            self.orders_to_target_options(
                                product=product, order_depth=depth,
                                current_pos=state.position.get(product, 0),
                                target_pos=target_pos,
                            )
                        )

        return orders, conversions, json.dumps(data)

    def orders_to_target_options(self, product, order_depth,
                                  current_pos, target_pos) -> List[Order]:
        orders: List[Order] = []
        diff = target_pos - current_pos
        if diff == 0:
            return orders
        bid = best_bid(order_depth); ask = best_ask(order_depth)
        if bid is None or ask is None:
            return orders
        bp, _ = bid; ap, _ = ask
        qty = min(abs(diff), ORDER_STEP)
        if diff > 0:
            orders.append(Order(product, int(ap), int(qty)))
        else:
            price = ap - QUOTE_IMPROVE
            if price <= bp:
                price = ap
            orders.append(Order(product, int(price), -int(qty)))
        return orders