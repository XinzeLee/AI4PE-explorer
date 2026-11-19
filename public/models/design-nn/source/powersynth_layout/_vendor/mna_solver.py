# SPDX-License-Identifier: GPL-3.0-only
# Extracted from e3da/PowerSynth2-core, commit 88af2fff2467f2e01db1d0ffc6c8c420968d65fc.
# See THIRD_PARTY.md for provenance and modifications.
import numpy as np
from time import perf_counter
import scipy
import warnings
import sys
from multiprocessing import Pool
import multiprocessing

class ModifiedNodalAnalysis:

    def __init__(self):
        """
        This module is used for most of the parasitic evaluation
        After the meshing state, the parasitic elements are processed and evaluated using this MNA solver
        """
        self.num_rl = 0
        self.num_ind = 0
        self.num_V = 0
        self.num_I = 0
        self.num_branch = 0
        self.num_opamps = 0
        self.num_vcvs = 0
        self.num_vccs = 0
        self.num_cccs = 0
        self.num_ccvs = 0
        self.num_cpld_ind = 0
        self.element = []
        self.el_type = {}
        self.pnode = {}
        self.nnode = {}
        self.net_map = {}
        self.cp_node = {}
        self.cn_node = {}
        self.vout = {}
        self.value = {}
        self.Vname = {}
        self.Lname1 = {}
        self.Lname2 = {}
        self.L_id = {}
        self.V_node = None
        self.cur_element = []
        self.cur_pnode = {}
        self.cur_nnode = {}
        self.cur_value = {}
        self.terminal_names = {}
        self.net_data = None
        self.branch_cnt = 0
        self.G = None
        self.M = None
        self.M_t = None
        self.D = None
        self.V = None
        self.J = None
        self.Ii = None
        self.Vi = None
        self.Z = None
        self.X = None
        self.A = None
        self.Mutual = {}
        self.func = []
        self.solver = None
        self.max_net_id = 0
        self.results_dict = {}
        self.node_dict = {}
        self.Rport = 50
        self.freq = 1000
        self.cur_src = []
        self.src_pnode = {}
        self.src_nnode = {}
        self.src_value = {}
        self.equiv_dict = {}
        self.imp_value = {}
        self.L_count = 0
        self.R_count = 0
        self.C_count = 0
        self.M_count = 0
        self.mode = 'RL'
        self.verbose = 0

    def assign_freq(self, freq=1000):
        """Set the frequency for the solver and calculate s

        Args:
            freq (int): frequency of the solver. Defaults to 1000 Hz.
        """
        self.freq = freq
        self.s = 2 * freq * np.pi * 1j

    def add_z_component(self, name, pnode, nnode, val):
        """
        Add a circuit component to the MNA solver
            Z = R + jwL
        Args:
            name (string): component name start with Z
            pnode (int): positive node
            nnode (int): negative node
            val (float): component value
        """
        int_node = 'in{}_{}'.format(pnode, nnode)
        Rname = 'R' + name.strip('Z')
        Lname = 'L' + name.strip('Z')
        self.add_component(Rname, pnode, int_node, np.real(val))
        self.add_component(Lname, int_node, nnode, np.imag(val) * 1j)

    def add_component(self, name, pnode, nnode, val):
        """
        Add a circuit component to the MNA solver

        Args:
            name (string): component name start with R/L/C
            pnode (int): positive node
            nnode (int): negative node
            val (float): component value
        """
        self.element.append(name)
        self.pnode[name] = pnode
        self.nnode[name] = nnode
        self.value[name] = val

    def remove_component(self, name):
        """
        Remove a circuit component
        Args:
            name (string): component name
        """
        self.element.remove(name)
        del self.pnode[name]
        del self.nnode[name]
        del self.value[name]

    def add_mutual_term(self, name, Z1_name, Z2_name, val):
        """
        Define a mutual term between two branch elements

        Args:
            name (string): Mutual element name
            Z1_name (string): L/Z name of the first branch
            Z2_name (string): L/Z name of the second branch
            val (float): Mutual value
        """
        self.element.append(name)
        self.Lname1[name] = Z1_name
        self.Lname2[name] = Z2_name
        self.value[name] = float(val)

    def add_indep_current_src(self, pnode=0, nnode=0, val=1, name='Is'):
        """
        Add an independent current source betwen two nets
        """
        self.cur_src.append(name)
        self.src_pnode[name] = pnode
        self.src_nnode[name] = nnode
        self.src_value[name] = float(val)

    def remove_current_src(self, name):
        """
        Remove an independent current source using its name
        """
        self.cur_src.remove(name)
        del self.src_pnode[name]
        del self.src_nnode[name]
        del self.src_value[name]

    def add_indep_voltage_src(self, pnode=0, nnode=0, val=1000, name='Vs'):
        """
        Add an independent voltage source between 2 nets
        """
        self.V_node = pnode
        self.element.append(name)
        self.pnode[name] = pnode
        self.nnode[name] = nnode
        self.value[name] = float(val)

    def remove_voltage_src(self, name):
        """
        Remove a voltage source using its name

        Args:
            name (_type_): remove a voltage source by name
        """
        self.element.remove(name)
        del self.pnode[name]
        del self.nnode[name]
        del self.value[name]

    def add_path_to_ground(self, node, ground=0, val=0.0001 + 1e-10j):
        """        
        Ground a net, with a very small impedance branch
        Args:
            node (int): net id
            ground (int): . Defaults to 0.
            val (float): terminal impedance value. Defaults to 1e-4+1e-10j.
        """
        equiv_name = 'Zt' + str(node)
        self.terminal_names[node] = equiv_name
        self.add_component(equiv_name, node, ground, val)

    def short_circuit(self, n1, n2):
        """
        Create a short between two nets
        """
        name = 'Zs{}{}'.format(n1, n2)
        self.pnode[name] = n1
        self.nnode[name] = n2
        self.add_component(name, n1, n2, 1e-09 + 1e-10j)

    def refresh(self):
        """       
        Clean up all stored info to reuse the solver for different analysis
        """
        self.cur_element = []
        self.cur_pnode = {}
        self.cur_nnode = {}
        self.cur_value = {}
        self.element = []
        self.pnode = {}
        self.nnode = {}
        self.cp_node = {}
        self.cn_node = {}
        self.vout = {}
        self.value = {}
        self.imp_value = {}
        self.Vname = {}
        self.Lname1 = {}
        self.Lname2 = {}
        self.L_id = {}
        self.max_net_id = 0
        self.results_dict = {}
        self.node_dict = {}
        self.L_count = 0
        self.R_count = 0
        self.C_count = 0
        self.M_count = 0

    def refresh_current_info(self):
        """
        Refresh current info to initial state
        """
        self.cur_element = []
        self.cur_pnode = {}
        self.cur_nnode = {}
        self.cur_value = {}

    def handle_branch_current_elements(self):
        """
        Loop through all elements and create unknown variable for each element
        """
        self.cur_element = []
        cur_id = 0
        for i in range(len(self.element)):
            el = self.element[i]
            x = self.element[i][0]
            if x == 'L' or x == 'V':
                self.cur_element.append(el)
                self.cur_pnode[el] = self.pnode[el]
                self.cur_nnode[el] = self.nnode[el]
                self.cur_value[el] = self.value[el]
                if x == 'L':
                    self.L_id[el] = cur_id
                cur_id += 1

    def find_vname(self, name):
        for i in range(len(self.cur_element)):
            el = self.cur_element[i]
            if name == el:
                n1 = self.cur_pnode[name]
                n2 = self.cur_nnode[name]
                return (n1, n2, i)
        print('failed to find matching branch element in find_vname')

    def mod_R_direct(self, name, net1, net2, val, add=True):
        """Modify the G matrix directly with the same given net-name - net-id map

        Args:
            name (str): resistor name
            net1 (_type_): name of net1 in string
            net2 (_type_): name of net2 in string
            val (_type_): value of the adde
        """
        self.add_component(name, net1, net2, val) if add else self.remove_component(name)
        n1 = self.net_name_to_net_id[net1]
        n2 = self.net_name_to_net_id[net2]
        self.handle_G_mat_element(n1, n2, name)

    def handle_G_mat_element(self, n1, n2, el_name):
        """Handle the G value with given net id so we dont need to rewrite them
         If neither side of the element is connected to ground
         then subtract it from appropriate location in matrix.
        Args:
            n1 (int): first net
            n2 (int): second net
            g (float): g value
        """
        g = abs(self.imp_value[el_name])
        if n1 != 0 and n2 != 0:
            self.G[n1 - 1, n2 - 1] += -g
            self.G[n2 - 1, n1 - 1] += -g
            self.G[n2 - 1, n2 - 1] += g
            self.G[n1 - 1, n1 - 1] += g
        if n1 == 0:
            self.G[n2 - 1, n2 - 1] += g
        if n2 == 0:
            self.G[n1 - 1, n1 - 1] += g

    def process_elements_impedances(self, s, x, elval):
        """
        Perform the s*L 1/R and s*C calculation outside of the loop for fast matrix formation
        Using Pool.star_map and map the values only, so it wont have collisions in the memory access

        Args:
            s (float): s value
            x (string): component type
            elval (float): compoent value

        Returns:
            imag or float: conductance value
        """
        if x == 'C':
            g = s * elval
        elif x == 'R':
            g = 1 / elval
        elif x == 'L':
            g = -s * np.imag(elval)
        elif x == 'M':
            g = -s * elval
        else:
            return 0
        return g

    def sequential_process_impednaces(self):
        """
        Evaluate all impedances sequentially
        """
        el_vals = [self.value[self.element[i]] for i in range(len(self.element))]
        el_types = [el[0] for el in self.element]
        results = []
        for i in range(len(self.element)):
            results.append(self.process_elements_impedances(self.s, el_types[i], el_vals[i]))
        self.imp_value = {self.element[i]: results[i] for i in range(len(self.element))}

    def parallel_process_elements_impedances(self):
        """
        I have tried this and found the multiprocessing is actually slower in some scenario.
        This is because the multiplication using numpy is not quite optimized.
        The processes are using for the same CPU instead of using all the resources.
        Need to have further look into this if the matrix setup is slowe. 
        For now the sequencetial is probably fast enought 
        """
        num_cpu = multiprocessing.cpu_count()
        el_vals = [self.value[self.element[i]] for i in range(len(self.element))]
        el_types = [el[0] for el in self.element]
        s_list = [self.s for i in range(len(self.element))]
        with Pool(num_cpu) as p:
            results = p.starmap(self.process_elements_impedances, zip(s_list, el_types, el_vals))
        self.imp_value = {self.element[i]: results[i] for i in range(len(self.element))}

    def matrix_formation(self, num_branch):
        """_summary_

        Args:
            num_branch (_type_): _description_
        """
        sn = 0
        t = perf_counter()
        self.sequential_process_impednaces()
        for i in range(len(self.element)):
            el = self.element[i]
            x = el[0]
            if x != 'M':
                n1 = self.net_name_to_net_id[self.pnode[el]]
                n2 = self.net_name_to_net_id[self.nnode[el]]
            if x == 'C' or x == 'R':
                self.handle_G_mat_element(n1, n2, el)
            if x == 'V':
                if num_branch > 1:
                    if n1 != 0:
                        self.M[n1 - 1, sn] = 1
                        self.M_t[sn, n1 - 1] = 1
                    if n2 != 0:
                        self.M[n2 - 1, sn] = -1
                        self.M_t[sn, n2 - 1] = -1
                else:
                    if n1 != 0:
                        self.M[n1 - 1] = 1
                        self.M_t[sn, n1 - 1] = 1
                    if n2 != 0:
                        self.M[n2 - 1] = -1
                        self.M_t[sn, n2 - 1] = -1
                sn += 1
            if x == 'L':
                if num_branch > 1:
                    imp = self.imp_value[el]
                    self.D[sn, sn] += imp
                    if n1 != 0:
                        self.M[n1 - 1, sn] = 1
                        self.M_t[sn, n1 - 1] = 1
                    if n2 != 0:
                        self.M[n2 - 1, sn] = -1
                        self.M_t[sn, n2 - 1] = -1
                else:
                    self.D[sn] += self.imp_value[el]
                    if n1 != 0:
                        self.M[n1 - 1] = 1
                        self.M_t[sn, n1 - 1] = 1
                    if n2 != 0:
                        self.M[n2 - 1] = -1
                        self.M_t[sn, n2 - 1] = -1
                sn += 1
            if x == 'M':
                Mname = el
                try:
                    ind1_index = self.L_id[self.Lname1[el]]
                    ind2_index = self.L_id[self.Lname2[el]]
                except:
                    print(Mname)
                    print('cant find element')
                    Mval = 1e-12
                Mval = self.value[el]
                self.Mutual[Mname] = Mval
                self.D[ind1_index, ind2_index] += self.imp_value[el]
                self.D[ind2_index, ind1_index] += self.imp_value[el]

    def V_mat(self, num_nodes):
        for i in range(num_nodes):
            net_id = i + 1
            net_name = self.net_id_to_net_name[net_id]
            self.V[i] = 'V({0})'.format(net_name)

    def J_mat(self):
        """
        The J matrix is an mx1 matrix, with one entry for each num_branch from a source
         sn = 0   # count num_branch source number
        """
        for i in range(len(self.cur_element)):
            self.J[i] = 'I({0})'.format(self.cur_element[i])

    def Ii_mat(self):
        """_summary_
        """
        if self.cur_src != []:
            for i in range(len(self.cur_src)):
                el = self.cur_src[i]
                n1 = self.net_name_to_net_id[self.src_pnode[el]]
                n2 = self.net_name_to_net_id[self.src_nnode[el]]
                g = float(self.src_value[el])
                self.current_val = g
                if n1 != 0:
                    self.Ii[n1 - 1] += -g
                if n2 != 0:
                    self.Ii[n2 - 1] += g

    def Vi_mat(self):
        """_summary_
        """
        sn = 0
        for i in range(len(self.cur_element)):
            el = self.cur_element[i]
            x = el[0]
            if x == 'V':
                self.Vi[sn] = self.cur_value[el]
                sn += 1
            else:
                self.Vi[sn] = 0
                sn += 1

    def Z_mat(self):
        self.Z = np.concatenate((self.Ii[:], self.Vi[:]), axis=0)

    def X_mat(self):
        self.X = np.concatenate((self.V[:], self.J[:]), axis=0)

    def A_mat(self, num_nodes, num_branch):
        n = num_nodes
        m = num_branch
        self.A = np.zeros((m + n, m + n), dtype=np.complex128)
        first_row = np.concatenate((self.G, self.M), axis=1)
        second_row = np.concatenate((self.M_t, self.D), axis=1)
        self.A = np.concatenate((first_row, second_row), axis=0)

    def process_all_nets(self):
        for k in self.pnode:
            net = self.pnode[k]
            if net in self.equiv_dict:
                self.pnode[k] = self.equiv_dict[net]
        for k in self.nnode:
            net = self.nnode[k]
            if net in self.equiv_dict:
                self.nnode[k] = self.equiv_dict[net]
        all_net = list(set(list(self.nnode.values()) + list(self.pnode.values()) + list(self.src_pnode.values()) + list(self.src_nnode.values())))
        if 'Gate' in all_net:
            print('Failed to remove gate')
        return all_net

    def equiv_nets(self, net1, net2):
        """
        Form a short between 2 nets
        Args:
            net1 (int): _description_
            net2 (int): _description_
        """
        self.equiv_dict[net1] = net2

    def graph_to_circuit_minimization(self):
        """
        This function will search for all equiv nets in the Graph to minimize the maxtrix size
        Check whether the circuit formulation is correct and map the nets into integers
        """
        all_net = self.process_all_nets()
        if not 0 in all_net:
            if self.verbose:
                print('NO GROUND, ADD A GROUND INTO CIRCUIT, ADDING A GROUND NODE')
        else:
            all_net.remove(0)
        self.num_nodes = len(all_net)
        self.net_name_to_net_id = {}
        self.net_id_to_net_name = {}
        self.net_name_to_net_id[0] = 0
        for net_id in range(1, self.num_nodes + 1):
            self.net_name_to_net_id[all_net[net_id - 1]] = net_id
            self.net_id_to_net_name[net_id] = all_net[net_id - 1]

    def matrix_init(self):
        """Initialize different matrices in the MNA solver
        """
        self.V = np.chararray((self.num_nodes, 1), itemsize=20)
        self.Ii = np.zeros((self.num_nodes, 1), dtype=np.complex128)
        self.G = np.zeros((self.num_nodes, self.num_nodes), dtype=np.complex128)
        num_branch = len(self.cur_element)
        self.M = np.zeros((self.num_nodes, num_branch), dtype=np.complex128)
        self.M_t = np.zeros((num_branch, self.num_nodes), dtype=np.complex128)
        self.D = np.zeros((num_branch, num_branch), dtype=np.complex128)
        self.Vi = np.zeros((num_branch, 1), dtype=np.complex128)
        self.J = np.chararray((num_branch, 1), itemsize=20)
        self.matrix_formation(num_branch)
        self.J_mat()
        self.V_mat(self.num_nodes)
        self.Ii_mat()
        self.Vi_mat()
        self.Z_mat()
        self.X_mat()
        self.A_mat(self.num_nodes, num_branch)

    def add_gmin(self, cmin=1e-12):
        """
        add a small capacitance value for every node
        this would resolve the singular matrix issue
        """
        for net_name in self.net_name_to_net_id:
            if net_name == 0:
                continue
            if 'p' in net_name:
                self.add_component('C{}'.format(net_name), net_name, 0, val=cmin)

    def solve_MNA(self):
        """
        Solve the MNA for current and voltage results
        """
        self.matrix_init()
        t = perf_counter()
        Z = self.Z
        A = self.A
        convergence = 0
        try:
            self.results = scipy.linalg.solve(A, Z)
        except:
            print('# The matrix is singular, there are many things can happen')
            print('# Numerically unstable due to small RL')
            print('# Floating Mesh there is something that is not setup properly/not grounded')
        if convergence != 0:
            if self.verbose:
                print('the GMRES simulation did not converge for given tolerance')
        if self.verbose:
            print('eval time', perf_counter() - t, convergence)
        self.results_dict = {}
        for i in range(len(self.X)):
            self.results_dict[self.X[i, 0].decode()] = self.results[i]
        self.results = self.results_dict

    def check_all_zeroes(self, matrix):
        """
        For debugging purpose to check if matrix A has all zeroes row.
        Args:
            matrix (_type_): _description_
        """
        rows, cols = matrix.shape
        for r in range(rows):
            r_all_zero = True
            for c in range(cols):
                val = matrix[r, c]
                if np.abs(val) != 0:
                    r_all_zero = False
            if r_all_zero:
                print('The unknown at this row is: {}'.format(self.X[r]))
                input('Row {} has all zeroes, singular matrix'.format(r))
        for c in range(cols):
            c_all_zero = True
            for r in range(rows):
                val = matrix[r, c]
                if np.abs(val) != 0:
                    c_all_zero = False
            if c_all_zero:
                print('The unknown at this row is: {}'.format(self.X[c]))
                input('Collumn {} has all zeroes, singular matrix'.format(c))

    def solve_iv(self, mode=2, method=1):
        """ old code for testing, will be removed later"""
        debug = True
        self.matrix_init()
        if mode == 0:
            case = 'no_current'
        elif mode == 1:
            case = 'no_voltage'
        elif mode == 2:
            case = 'full_eval'
        if case == 'no_current':
            Z = self.Ii
            Dinv = -np.linalg.inv(self.D)
            A = np.linalg.multi_dot([self.M, Dinv, self.M_t])
        elif case == 'full_eval':
            Z = self.Z
            A = self.A
        elif case == 'no_voltage':
            Z = self.Vi
            A = self.D
        if debug:
            self.debug_singular_mat_issue(A)
            self.check_all_zeroes(self.A)
        if method == 1:
            self.results = scipy.sparse.linalg.spsolve(A, Z)
        elif method == 2:
            self.results = np.linalg.solve(A, Z)
        elif method == 3:
            self.results = scipy.linalg.solve(A, Z)
        elif method == 4:
            self.results = np.linalg.lstsq(A, Z)[0]
        elif method == 5:
            self.results = np.linalg.inv(A) * Z
            self.results = np.squeeze(np.asarray(self.results))
        self.results_dict = {}
        rlmode = True
        if case == 'no_current':
            names = self.V
        elif case == 'full_eval':
            names = self.X
        elif case == 'no_voltage':
            names = self.J
            print(self.J.shape)
        if rlmode:
            for i in range(len(names)):
                self.results_dict[names[i, 0].decode()] = self.results[i]
        self.results = self.results_dict

    def display_results(self):
        """
        Display the computed voltage and current results
        """
        for r in self.results:
            r_val = self.results[r]
            print('name: {} -- real {} imag {}'.format(r, np.real(r_val), np.imag(r_val)))

    def debug_singular_mat_issue(self, mat_A):
        """
        :param mat_A: a square matrix to analyze
        :return: a debug sequence. Use pycharm debugger for better view
        """
        if not np.linalg.cond(mat_A) < 1 / sys.float_info.epsilon:
            print(('machine epsilon', sys.float_info.epsilon))
            print(('A is singular, check it', np.linalg.cond(mat_A), '1/eps', 1 / sys.float_info.epsilon))
            N = mat_A.shape[0]
            V = np.zeros((N, N))
            for r in range(N):
                for c in range(N):
                    if int(mat_A[r, c]) != 0:
                        V[r, c] = 1
            plt.imshow(V)
            plt.plot()

    def netlist_dump(self, id, path, output_nets=[]):
        """Take the solution id to generate the subckt

        Args:
            id (int): sol_id
            path (str): path to save netlist
            output_nets (list): list of (assumed) net names of some components on the layout e.g leads, device-pins
        """
        out = ''
        out += '* PEEC Circuit for layout solution {}\n'.format(id)
        output_str = ''
        for net in output_nets:
            output_str += ' ' + net
        out += '.SUBCKT Module_{} {}\n'.format(id, output_str)
        el_format = '{name} {n1} {n2} {val} \n'
        mu_format = '{name} {l1} {l2} {val} \n'
        mutual_list = []
        for e in self.element:
            if 'V' in e:
                continue
            if 'M' in e:
                mutual_list.append(e)
                continue
            val = self.value[e]
            val = np.imag(val) if 'L' in e else val
            line = el_format.format(name=e, n1=self.pnode[e], n2=self.nnode[e], val=val)
            out += line
        for mu in mutual_list:
            l1 = self.Lname1[mu]
            l2 = self.Lname2[mu]
            m_val = self.value[mu]
            m_line = mu_format.format(name=mu, l1=l1, l2=l2, val=m_val)
            out += m_line
        out += '.ENDS\n'
        with open(path, 'w') as f:
            f.write(out)
        f.close()

def test_ModifiedNodalAnalysis1():
    circuit = ModifiedNodalAnalysis()
    circuit.add_component('B1', 1, 2, 1 + 1e-09j)
    circuit.add_component('B2', 3, 4, 1 + 1e-09j)
    circuit.add_mutual_term('M12', 'B1', 'B2', 2e-10)
    circuit.add_indep_current_src(1, 0, 1)
    circuit.assign_freq(10000)
    circuit.handle_branch_current_elements()
    circuit.solve_iv()
    imp = circuit.results['v1']
    print((np.real(imp), np.imag(imp) / circuit.s))

def test_ModifiedNodalAnalysis2():
    circuit = ModifiedNodalAnalysis()
    circuit.add_component('B1', 1, 2, 1 + 1e-09j)
    circuit.add_component('B2', 2, 3, 1 + 1e-09j)
    circuit.add_component('B3', 1, 3, 1 + 1e-09j)
    circuit.add_component('B4', 3, 0, 1 + 1e-09j)
    circuit.add_mutual_term('M13', 'B1', 'B3', 1e-09)
    circuit.add_mutual_term('M12', 'B2', 'B3', 1e-09)
    circuit.add_indep_current_src(0, 1, 1)
    circuit.assign_freq(100)
    circuit.handle_branch_current_elements()
    circuit.solve_iv()
    print(circuit.results)
    imp = circuit.results['v1'] / 1
    print((np.real(imp), np.imag(imp) / circuit.s))

def test_ModifiedNodalAnalysis3():
    circuit = ModifiedNodalAnalysis()
    circuit.add_component('B1', 1, 2, 1 + 6.92e-09j)
    circuit.add_component('B8', 2, 3, 1 + 1.48e-09j)
    circuit.add_component('B2', 3, 5, 1 + 4.8e-09j)
    circuit.add_component('B9', 3, 4, 1 + 1.39e-09j)
    circuit.add_component('B3', 4, 5, 1 + 5e-09j)
    circuit.add_component('B4', 5, 6, 1 + 5.95e-10j)
    circuit.add_component('B5', 6, 7, 1 + 1.7e-09j)
    circuit.add_component('B6', 6, 0, 1 + 3.54e-09j)
    circuit.add_component('B7', 7, 0, 1 + 3.54e-09j)
    circuit.add_mutual_term('M23', 'B2', 'B3', 2.22e-09)
    circuit.add_mutual_term('M67', 'B6', 'B7', 7.9e-10)
    circuit.add_indep_voltage_src(0, 1, 1)
    circuit.assign_freq(1000000000.0)
    circuit.handle_branch_current_elements()
    circuit.solve_iv()
    print(circuit.results)
    imp = circuit.results['v1'] / circuit.results['I_Vs']
    print((np.real(imp), np.imag(imp) / circuit.s))

def test_ModifiedNodalAnalysis4():
    circuit = ModifiedNodalAnalysis()
    circuit.add_z_component('Z1', 'a', 'b', 1 + 1e-08j)
    circuit.add_z_component('Z2', 'a', 'b', 1 + 1e-08j)
    circuit.add_indep_voltage_src('a', 0, 1)
    circuit.add_component('R1', 'b', 0, 1e-06)
    circuit.assign_freq(1000000000.0)
    circuit.graph_to_circuit_minimization()
    circuit.handle_branch_current_elements()
    circuit.solve_MNA()
    print(circuit.results)

def test_ModifiedNodalAnalysis5():
    circuit = ModifiedNodalAnalysis()
    circuit.add_component('R5', 'bw1', 0, 1e-06)
    circuit.add_component('R3', 'bw1', 1, 1)
    circuit.add_component('L4', 1, 'bw2', 1e-09j)
    circuit.add_component('R2', 'bw1', 2, 1)
    circuit.add_component('L5', 2, 'bw2', 1e-09j)
    circuit.add_component('Rds', 'bw2', 4, 0.025)
    circuit.add_component('L9', 4, 5, 1e-09)
    circuit.add_component('Rfloat', 'f1', 'f2', 1)
    circuit.add_component('Lfloat', 'f2', 0, 1e-09)
    circuit.add_mutual_term('M23', 'L4', 'Lfloat', 1.44e-08)
    circuit.add_indep_current_src(0, 'bw2', 1)
    circuit.assign_freq(1000000000.0)
    circuit.graph_to_circuit_minimization()
    circuit.handle_branch_current_elements()
    circuit.solve_iv(method=2)
    print(circuit.results)
    imp = circuit.results['V(bw2)']
    print((np.real(imp), np.imag(imp) / circuit.s))
