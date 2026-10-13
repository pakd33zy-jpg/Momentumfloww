"""Unit tests for the causal, research-only EMA/MACD proxy."""
import importlib.util
import pathlib
import unittest

FILE = pathlib.Path(__file__).with_name("ema_macd_ablation.py")
spec = importlib.util.spec_from_file_location("ema_macd_ablation", FILE)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

def synthetic():
    rows = [[i*3600, 100.0, 101.0, 99.0, 100.0, 1.0] for i in range(205)]
    rows[204] = [204*3600, 110.0, 111.0, 109.0, 110.0, 1.0]
    macd = [-1.0]*205
    macd[201:203] = [1.0,1.0]  # Entry signal at closed candle 201 -> next open 202
    macd[203] = -1.0          # Exit signal at closed candle 203 -> next open 204
    indicators = {"macd":macd, "signal":[0.0]*205,
                  "ema20":[95.0]*205, "ema200":[90.0]*205,"atr":[1.0]*205}
    return rows,indicators

class CausalTest(unittest.TestCase):
    def setUp(self):
        self.cost = mod.SIDE_COST
        mod.SIDE_COST=0.0
    def tearDown(self):
        mod.SIDE_COST=self.cost
    def test_next_open_exit_and_entry_no_future_peek(self):
        rows,ind=synthetic()
        result=mod.backtest(rows,ind,201*3600,205*3600,"macd_cross")
        self.assertEqual(result["trades"],1)
        self.assertAlmostEqual(result["return_pct"],10.0,places=2)
        self.assertEqual(result["exit_reasons"],{"macd_exit_next_open":1})
        # If the future exit at 204 were magically available at 203, exit would be too early.
        self.assertEqual(mod.backtest(rows,ind,201*3600,204*3600,"macd_cross")["return_pct"],0.0)
    def test_incremental_entry_filters(self):
        rows,ind=synthetic()
        self.assertEqual(mod.backtest(rows,ind,201*3600,205*3600,"plus_ema20")["trades"],1)
        ind["ema200"]=[110.0]*205
        self.assertEqual(mod.backtest(rows,ind,201*3600,205*3600,"plus_ema200")["trades"],0)
        self.assertEqual(mod.backtest(rows,ind,201*3600,205*3600,"plus_ema20")["trades"],0)
    def test_cost_increases_reduce_returns(self):
        rows,ind=synthetic()
        mod.SIDE_COST=0.0
        without=mod.backtest(rows,ind,201*3600,205*3600,"macd_cross")
        mod.SIDE_COST=0.0025
        with_friction=mod.backtest(rows,ind,201*3600,205*3600,"macd_cross")
        self.assertLess(with_friction["return_pct"],without["return_pct"])
    def test_pessimistic_stop_when_stop_and_target_both_touch(self):
        rows,ind=synthetic()
        rows[202][2]=110;rows[202][3]=95
        result=mod.backtest(rows,ind,201*3600,205*3600,"plus_atr_2r")
        self.assertEqual(result["exit_reasons"],{"entry_bar_stop":1})
        self.assertLess(result["return_pct"],0)
    def test_ema_warmup_not_available_early(self):
        vals=list(range(200))
        out=mod.ema(vals,200)
        self.assertTrue(all(x is None for x in out[:-1]))
        self.assertEqual(out[-1],99.5)

if __name__ == "__main__":
    unittest.main()
