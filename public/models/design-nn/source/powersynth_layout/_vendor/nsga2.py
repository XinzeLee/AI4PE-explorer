# SPDX-License-Identifier: GPL-3.0-only
# Extracted from e3da/PowerSynth2-core, commit 88af2fff2467f2e01db1d0ffc6c8c420968d65fc.
# See THIRD_PARTY.md for provenance and modifications.
import random
import array
import numpy
import numpy.random as nprandom
from deap import algorithms, base, creator, tools

class DesignVar(object):
    def __init__(self, constraints, init_values):
        """
        Design variable data structure
        
        Keyword Arguments:
        constraints -- tuple (length of 2) of min and max constraints (min, max)
        init_values -- tuple (length of 2) of min and max for design var initialization (min, max)
        """
        self.constraints = constraints
        self.init_values = init_values     

class NSGAII_Optimizer(object):
    def __init__(self, design_vars, eval_fn, num_measures, seed, num_layouts, num_gen,
                  CrossProb, MutaProb):
        """
        http://ieeexplore.ieee.org/xpls/abs_all.jsp?arnumber=996017&tag=1
        Creates a new NSGAII_Optimizer object
        
        Keyword Arguments:
        design_vars -- list of DesignVar objects (represent design parameters and their constraints)
        eval_fn -- function reference to design update/generation function
        num_measures -- int, number of objective functions (performance measures)
        seed -- int, random number seed
        num_gen -- int, number of generations
        
        mu -- int, represents the population size
        lamba -- int, represents the offspring population size
        cxpb -- float, (0.0 to 1.0), represents crossover probability
        mutpb -- float, (0.0 to 1.0), represents mutation probability
        
        """
        
        self.design_vars = design_vars
        self.eval_fn = eval_fn
        self.num_measures = num_measures
        self.seed = seed
        self.num_layouts = num_layouts
        self.num_gen = num_gen
        
        self.mu = int(num_layouts/(1+2*num_gen))
        self.cxpb = CrossProb
        self.mutpb = MutaProb
        random.seed(self.seed)
        nprandom.seed(self.seed)

        min_weights = []
        for i in range(self.num_measures):
            min_weights.append(-1.0)
        min_weights = tuple(min_weights)
        
        if not hasattr(creator, "PSLayoutFitnessMin2"):
            creator.create("PSLayoutFitnessMin2", base.Fitness, weights=min_weights)
        if not hasattr(creator, "PSLayoutIndividual2"):
            creator.create("PSLayoutIndividual2", array.array, typecode='d', fitness=creator.PSLayoutFitnessMin2)
        
        self.toolbox = base.Toolbox()
        self.toolbox.register("individual", self._init_individual, creator.PSLayoutIndividual2)
        self.toolbox.register("population", tools.initRepeat, list, self.toolbox.individual)
        
        self.toolbox.register("evaluate", self.eval_fn)
        self.toolbox.register("mate", tools.cxBlend, alpha=1.5)
        self.toolbox.register("mutate", tools.mutGaussian, mu=0, sigma=3, indpb=0.3)
        self.toolbox.register("select", tools.selNSGA2)
        
        self.toolbox.decorate("mate", self._check_bounds())
        self.toolbox.decorate("mutate", self._check_bounds())
        
        self.population = self.toolbox.population(n=self.mu)
        self.solutions = tools.ParetoFront()
        
        self.stats = tools.Statistics(key=lambda ind: ind.fitness.values)
        self.stats.register("Avg", numpy.mean)
        self.stats.register("Std", numpy.std)
    
    def _init_individual(self, Individual):
        ind = []
        #print("initialization")
        for dv in self.design_vars:
            # random.seed(self.seed)
            init0=dv.init_values[0]
            init1=dv.init_values[1]
            ind.append(random.uniform(init0, init1))
        return Individual(ind)
        
    def run(self):
        """Runs the optimizer"""
        algorithms.eaMuPlusLambda(self.population, self.toolbox, 
                                  mu=self.mu, lambda_=self.mu*2, 
                                  cxpb=self.cxpb, mutpb=self.mutpb, ngen=self.num_gen, 
                                  stats=self.stats, halloffame=self.solutions, verbose=False)
        
    def _check_bounds(self):
        def dec_check_bounds(func):
            def wrap_check_bounds(*args, **kargs):
                offsprings = func(*args, **kargs)
                for child in offsprings:
                    for i in range(len(self.design_vars)):
                        consts = self.design_vars[i].constraints
                        # Min Check
                        if child[i] < consts[0]:
                            child[i] = consts[0]
                        # Max Check
                        elif child[i] > consts[1]:
                            child[i] = consts[1]
                return offsprings
            return wrap_check_bounds
        return dec_check_bounds
