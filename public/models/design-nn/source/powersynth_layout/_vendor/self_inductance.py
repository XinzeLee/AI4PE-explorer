# SPDX-License-Identifier: GPL-3.0-only
# Extracted from e3da/PowerSynth2-core, commit 88af2fff2467f2e01db1d0ffc6c8c420968d65fc.
# See THIRD_PARTY.md for provenance and modifications.
import math
import numpy as np
from numba import njit
from math import sqrt, asinh, atan
PI = math.pi

@njit(cache=True)
def self_ind_py(w,l,t):
    '''This function is from FastHenry Joelself.c might consider to rewrite this in C++ for speed up
    https://github.com/ediloren/FastHenry2/blob/master/src/fasthenry/joelself.c
    '''
    
    w1 = w/l
    t1 = t/l
    r = sqrt(w1*w1 + t1*t1)
    aw = sqrt(w1*w1 + 1)
    at = sqrt(t1*t1 + 1)
    ar = sqrt(w1*w1 +t1*t1 +1)
    z = 0.25 * ((1/w1) * asinh(w1/at) + (1/t1) * asinh(t1/aw) + asinh(1/r)) # checked

    z += (1/24.0) * ((t1*t1/w1) * asinh(w1/(t1*at*(r+ar))) +(w1*w1/t1) *asinh(t1/(w1*aw*(r+ar))) +\
         ((t1*t1)/(w1*w1))* asinh(w1*w1/(t1*r*(at+ar)))+ ((w1*w1)/(t1*t1))* asinh(t1*t1/(w1*r*(aw+ar))) +\
         (1.0/(w1*t1*t1))*asinh(w1*t1*t1/(at*(aw+ar)))+ (1.0/(t1*w1*w1)*asinh(t1*w1*w1/(aw*(at+ar)))))
    z -= (1.0/6.0) * ((1.0/(w1*t1))*atan((w1*t1)/ar) + (t1/w1)* atan(w1/(t1*ar))+(w1/t1)*atan(t1/(w1*ar))) 
    z -= (1.0/60.0) *(((ar +r+t1+at)*t1*t1)/((ar+r)*(r+t1)*(t1+at)*(at+ar))\
                    + ((ar +r+w1+aw)*(w1*w1))/((ar+r)*(r+w1)*(w1+aw)*(aw+ar))\
                    + (ar+aw+1+at)/((ar+aw)*(aw+1)*(at+1)*(at+ar))) # checked
    z -= (1.0/20.0) * (1.0/(r+ar) + 1.0/(aw+ar) + 1.0/(at+ar)) 
    z *= (2.0/PI) 
    z *= l
    #print (z*1e-6)
    return z * 4*PI*1e-7 # inductance in uH -> H

@njit(cache=True)
def CalVal2(k):
    val2 = 2e-7 * (np.log(np.sqrt(k**2+1) +k) - np.sqrt(1/k**2 +1) + 0.9054/k +0.25)
    return abs(val2)
