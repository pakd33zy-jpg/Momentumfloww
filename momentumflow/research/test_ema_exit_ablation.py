"""Regression tests for EMA exit timing and cost behavior."""
import unittest
from ema_exit_ablation import backtest_exit

def fixture():
    rows=[[i*3600,100.,101.,99.,100.,1.] for i in range(205)]
    rows[203][4]=94.0
    rows[204]=[204*3600,110.,111.,109.,110.,1.]
    macd=[-1.]*205
    macd[201]=macd[202]=1.
    state={"macd":macd,"signal":[0.]*205,
           "ema200":[90.]*205,"ema20":[95.]*205}
    return rows,state

class ExitTest(unittest.TestCase):
    def test_ema20_exit_is_after_closed_signal(self):
        rows,state=fixture()
        result=backtest_exit(rows,state,201*3600,205*3600,"ema20_breach",0.)
        self.assertEqual(result["trades"],1)
        self.assertEqual(result["exits"]["trend_break"],1)
        self.assertEqual(result["return_pct"],10.)
        # Don't process the next candle's opening price before that candle exists.
        earlier=backtest_exit(rows,state,201*3600,204*3600,"ema20_breach",0.)
        self.assertEqual(earlier["return_pct"],-6.)
        self.assertEqual(earlier["exits"],{"end_mark":1})
    def test_two_closes_needed(self):
        rows,state=fixture()
        one=backtest_exit(rows,state,201*3600,205*3600,"ema20_2_closes",0.)
        self.assertEqual(one["exits"],{"end_mark":1})
        rows[202][4]=94.
        two=backtest_exit(rows,state,201*3600,205*3600,"ema20_2_closes",0.)
        self.assertEqual(two["exits"],{"trend_break":1})
    def test_ema200_holds_until_breach(self):
        rows,state=fixture()
        hold=backtest_exit(rows,state,201*3600,205*3600,"ema200_breach",0.)
        self.assertEqual(hold["exits"],{"end_mark":1})
        rows[203][4]=85.
        exit_now=backtest_exit(rows,state,201*3600,205*3600,"ema200_breach",0.)
        self.assertEqual(exit_now["exits"],{"trend_break":1})
    def test_friction_effect(self):
        rows,state=fixture()
        a=backtest_exit(rows,state,201*3600,205*3600,"ema20_breach",0.)
        b=backtest_exit(rows,state,201*3600,205*3600,"ema20_breach",.0025)
        self.assertLess(b["return_pct"],a["return_pct"])

if __name__=="__main__":
    unittest.main()
