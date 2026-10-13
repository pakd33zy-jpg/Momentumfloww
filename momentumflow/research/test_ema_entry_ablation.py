"""Offline regression tests for the one-change MACD/EMA entry screen."""
import unittest
from ema_entry_ablation import entry_passes, test_entry_filter

def fixture():
    rows = [[i*3600, 100., 101., 99., 100., 1.] for i in range(205)]
    rows[201] = [201*3600, 101., 103., 99., 102., 3.]
    rows[202] = [202*3600, 100., 102., 98., 100., 1.]
    rows[203] = [203*3600, 100., 101., 90., 94., 1.]
    rows[204] = [204*3600, 110., 111., 109., 110., 1.]
    macd = [-1.]*205
    macd[201] = 1.
    macd[202] = 1.
    return rows, {
        "macd": macd,
        "signal": [0.]*205,
        "ema20": [95.]*205,
        "ema200": [90.]*205
    }

class EntryAblationTests(unittest.TestCase):
    def test_baseline_closed_candle_next_open(self):
        rows,ind=fixture()
        result=test_entry_filter(rows,ind,201*3600,205*3600,"baseline",0.)
        self.assertEqual(result["round_trips"],1)
        self.assertEqual(result["return_pct"],10.)
        # Until next candle's price exists, cannot exit at its open.
        earlier=test_entry_filter(rows,ind,201*3600,204*3600,"baseline",0.)
        self.assertEqual(earlier["return_pct"],-6.)
    def test_macd_positive_filter_excludes_nonpositive_crosses(self):
        rows,ind=fixture()
        ind["macd"][201]=-0.1
        ind["signal"][201]=-0.5
        self.assertEqual(test_entry_filter(rows,ind,201*3600,205*3600,"macd_positive",0.)["round_trips"],0)
    def test_breakout_uses_only_past_highs(self):
        rows,ind=fixture()
        volume=[0.]
        for r in rows:volume.append(volume[-1]+r[5])
        self.assertTrue(entry_passes(rows,ind,201,"breakout_prior_24h",volume))
        rows[200][2]=104.
        self.assertFalse(entry_passes(rows,ind,201,"breakout_prior_24h",volume))
    def test_volume_excludes_current_hour_from_average(self):
        rows,ind=fixture()
        volume=[0.]
        for r in rows:volume.append(volume[-1]+r[5])
        self.assertTrue(entry_passes(rows,ind,201,"volume_over_1p5x_prior_24h",volume))
        rows[200][5]=60.
        volume=[0.]
        for r in rows:volume.append(volume[-1]+r[5])
        self.assertFalse(entry_passes(rows,ind,201,"volume_over_1p5x_prior_24h",volume))
    def test_cost_reduces_return(self):
        rows,ind=fixture()
        cheap=test_entry_filter(rows,ind,201*3600,205*3600,"baseline",0.)
        costly=test_entry_filter(rows,ind,201*3600,205*3600,"baseline",.0025)
        self.assertLess(costly["return_pct"],cheap["return_pct"])
    def test_unsupported_entry_filter_rejected(self):
        rows,ind=fixture()
        with self.assertRaises(ValueError):
            test_entry_filter(rows,ind,201*3600,205*3600,"magic_future_filter",0.)

if __name__=="__main__":
    unittest.main()
