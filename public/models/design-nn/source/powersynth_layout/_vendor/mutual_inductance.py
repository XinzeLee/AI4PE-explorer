# SPDX-License-Identifier: GPL-3.0-only
# Extracted from e3da/PowerSynth2-core, commit 88af2fff2467f2e01db1d0ffc6c8c420968d65fc.
# See THIRD_PARTY.md for provenance and modifications.
import numpy as np
from numba import njit

@njit(cache=True)
def inter_func1(x, y, z):
    '''
    Inner calculation of mutual inductance fucntion
    '''
    x2 = x * x
    x3 = x2 * x
    x4 = x3 * x
    y2 = y * y
    y3 = y2 * y
    y4 = y3 * y
    z2 = z * z
    z3 = z2 * z
    z4 = z3 * z
    sum4 = 1 / 60.0 * (x4 + y4 + z4 - 3 * x2 * y2 - 3 * y2 * z2 - 3 * x2 * z2) * np.sqrt(x2 + y2 + z2)
    if (y != 0 and z != 0) or (x != 0 and y != 0) or (x != 0 and z != 0):
        sum1 = (y2 * z2 / 4.0 - y4 / 24.0 - z4 / 24.0) * x * np.log(
            (x + np.sqrt(x2 + y2 + z2)) / np.sqrt(y2 + z2))  # if ((z2+y2)!=0) else 0
        sum2 = (x2 * z2 / 4.0 - x4 / 24.0 - z4 / 24.0) * y * np.log(
            (y + np.sqrt(x2 + y2 + z2)) / np.sqrt(x2 + z2))  # if ((z2 + x2) != 0) else 0
        sum3 = (x2 * y2 / 4.0 - x4 / 24.0 - y4 / 24.0) * z * np.log(
            (z + np.sqrt(x2 + y2 + z2)) / np.sqrt(x2 + y2))  # if ((x2+y2) != 0) else 0
        sum5 = -x * y * z3 / 6.0 * np.arctan(x * y / (z * np.sqrt(x2 + y2 + z2))) if z != 0 else 0
        sum6 = -x * y3 * z / 6.0 * np.arctan(x * z / (y * np.sqrt(x2 + y2 + z2))) if y != 0 else 0
        sum7 = -x3 * y * z / 6.0 * np.arctan(y * z / (x * np.sqrt(x2 + y2 + z2))) if x != 0 else 0
        return sum1 + sum2 + sum3 + sum4 + sum5 + sum6 + sum7
    else:
        return sum4

@njit(cache=True)
def mutual_between_bars(params):
    w1,l1,t1,w2,l2,t2,l3,p,E = params
    '''
    This function is used to compute the mutual inductance value between 2 rectangular bars in space.
    all dimension are in um with type int
    and return nH

    :param w1: first bar 's width
    :param l1: first bar 's length
    :param t1: first bar 's thick
    :param w2: second bar 's width
    :param l2: second bar 's length
    :param t2: second bar 's thick
    :param l3: distance between two bars' (longtitude)
    :param p: height of second bar (+z)
    :param E: distance between 2 bars'
    :return: Mutual inductance of 2 bars in nH
    '''
    w1 = w1*0.1 
    l1 = l1*0.1 
    t1 = t1*0.1 

    w2 = w2*0.1 
    l2 = l2*0.1 
    t2 = t2*0.1 

    l3 = l3*0.1 
    p = p*0.1 
    E = E*0.1
    Const = 0.001 / (w1 * t1 * w2 * t2)
    add_val = outer_addition(E - w1, E + w2 - w1, E + w2, E, p - t1, p + t2 - t1, p + t2, p, l3 - l1, l3 + l2 - l1, l2 + l3, l3)

    Mb = Const *  add_val
    return Mb   # in nH

@njit(cache=True)
def outer_addition(q1, q2, q3, q4, r1, r2, r3, r4, s1, s2, s3, s4):
    '''
    Compute the out - most
    :param fxyz: function to be integrated
    :return:
    '''
    q = np.abs(np.array([q1, q2, q3, q4]))
    r = np.abs(np.array([r1, r2, r3, r4]))
    s = np.abs(np.array([s1, s2, s3, s4]))
    
    res = 0
    for i in range(1,5,1):
        for j in range(1, 5, 1):
            for k in range(1, 5, 1):
                inter_val=inter_func1(q[i - 1], r[j - 1], s[k - 1])
                res += np.power(-1,(i+j+k+1))* inter_val
    
    return res
