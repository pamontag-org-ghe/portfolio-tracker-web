---
name: "ttwr-mtwr-calculator"
description: "Calculate the time-weighted and money-weighted rates of return for a portfolio. Use when you have to have information about the correct formulas for calculating the TWR and MWR, and when you want to understand the differences between these two measures of return."
---

# What is the time-weighted rate of return (TWR)?
The time-weighted return is a measure of return. It can be used to measure the performance of a portfolio and compare it with others. The basis for calculating the TWR is the returns of the individual periods. These can be days, for example, in which case the return of each individual day is used for the calculation. The time-weighted return completely ignores incoming and outgoing payments. This is the only reason why a comparison with other portfolios is possible.

# What is the money-weighted rate of return (MWR)?
With the MWR, the amount and timing of an investment are decisive for the level of return. The calculation of performance with the MWR is therefore very precise, so that the actual performance is reflected. The money-weighted return can also be used to assess how good the individual investment decisions were. In contrast to the TWR, a comparison with other portfolios is not possible.
 
# TWR vs. MWR: advantages and disadvantages at a glance
The main difference between the two measures of return is that the TWR ignores incoming and outgoing payments. The MWR, on the other hand, takes into account the amount and timing of investments. This results in the following advantages and disadvantages:

|| TWR | MWR |
|---| --- | --- |
| Comparability of performance | possible | not possible |
| Accuracy of the performance | imprecise, may deviate from actual performance | accurate, delivers effective performance |

The disadvantage of the TWR is that it can deviate from the actual performance of the portfolio. This can even go so far that the portfolio has lost value in francs and centimes, but the TWR is still positive (or vice versa).

Because the MWR takes into account the amount and timing of investments, it is close to the actual performance of the portfolio in francs and centimes.

You can see what we mean in the following table: The effective performance of the portfolio is minus 16 francs. On average, you have therefore lost just over five francs per day. If we say that the daily performance in per cent is minus 5.432, this is relatively consistent. This is in contrast to the performance with the TWR, which is plus 5 per cent for the table below.

| Day | Deposit and withdrawal* | Initial value | Final value | Profit/loss |
|---|---|---|---|---|
| 1 | + 100 CHF | 100 CHF | 110 CHF | + 10 CHF |
| 2 | + 100 CHF | 210 CHF | 172 CHF | – 38 CHF |
| 3 | – 100 CHF | 72 CHF | 84 CHF | + 12 CHF |
| Total | | | | – 16 CHF |
*Incoming and outgoing payments are credited at the beginning of each period.
 
# How can I calculate the TWR?
First, you must determine the returns for the individual days. To do this, subtract the initial value from the final value. The final value is the portfolio value at the end of the day, while the initial value is the portfolio value at the end of the previous day. If you divide this profit or loss by the initial value, you will obtain the return as a decimal number.

The formula looks like this: (final value – initial value) / profit or loss = return as a decimal number

The daily returns are then added to 1 and then multiplied together:

TWR = (1 + 0.1000) * (1 +(- 0.1818)) * (1 + 0.1666) – 1 = 0.05 = + 5 %

| Day | Deposit and withdrawal | Initial value | Final value | Profit/loss | Yield in % | Yield as a decimal number |
|---|---|---|---|---|---|---|
| 1 | | 100 CHF | 110 CHF | + 10 CHF | + 10.00 % | + 0.1000 |
| 2 | (+ 100 CHF)* | 110 CHF | 90 CHF | – 20 CHF | – 18.18 % | – 0.1818 |
| 3 | (- 100 CHF)* | 90 CHF | 105 CHF | + 15 CHF | + 16.66 % | + 0.1666 |
| TWR | | | | | | + 0.0500 |
*Incoming and outgoing payments are ignored when calculating the TWR.

# How can I calculate the money-weighted return?
The MWR is calculated using the approximation method. The approximation method searches for the correct value for the variable “MWR” until the correct number is found.

The MWR can be calculated in Excel using the “IRR” formula. To do this, the cash flows must be listed one below the other as shown in the table below. The formula is then, for example, “=IRR(C2:C4)”.

This results in a money-weighted return of minus 5.432 per cent. This is a daily return because we have worked with days. The daily return can then be converted into a monthly, quarterly or annual return figure as required.

If payments are not evenly distributed over time, the formula “XIRR” can be used instead.

| Day | Remark | Deposit and withdrawal |
|---|---|---|
| 1 | Deposit | -100 CHF |
| 2 | Back payment | – 100 CHF |
| 3 | Current portfolio value that you could theoretically obtain | + 184 CHF |
| MWR | | -5.432 %* |
*This is the daily return.