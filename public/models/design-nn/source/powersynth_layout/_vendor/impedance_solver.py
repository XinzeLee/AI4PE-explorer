# SPDX-License-Identifier: GPL-3.0-only
# Extracted from e3da/PowerSynth2-core, commit 88af2fff2467f2e01db1d0ffc6c8c420968d65fc.
# See THIRD_PARTY.md for provenance and modifications.
from .mna_solver import ModifiedNodalAnalysis
import numpy as np
import networkx as nx
from itertools import combinations, groupby
import random
import time

class Port:
    def __init__(self, pnode:int,nnode:int, index:int, MNA_obj) -> None:
        '''
        A Port object with different status to modify the MNA circuit.
        '''
        self.pnode = pnode
        self.nnode = nnode
        self.solver = MNA_obj
        self.name = "P{}_{}".format(pnode,nnode)
        self.v_mode = 0
        self.z_i_mode = 0 # zero current set
        self.s = self.solver.freq*2*np.pi
        self.index = index # use to map this port impedance to the matrix
        
    def set_voltage(self):
        ''' Add a voltage source of 1 V between port + and -'''
        self.solver.add_indep_voltage_src(self.pnode,0,1,'V_{}'.format(self.name))
        self.solver.add_component('R_'+self.name, self.nnode, 0 , 1e-12) # add a small impedance to ground
        self.v_mode = 1
    
    def set_zero_current(self):
        ''' Add a current source of 0 A between port + and - '''
        self.solver.add_indep_current_src(self.pnode,0,0,'I_{}'.format(self.name))    
        self.solver.add_component('R_'+self.name, self.nnode, 0 , 1e-12) # add a small impedance to ground
        self.z_i_mode = 1
    
    def reset_port(self):
        ''' Remove the current and voltage stimulation for next run'''
        if self.v_mode:
            self.solver.remove_voltage_src(name= 'V_{}'.format(self.name))
            self.v_mode=0
        elif self.z_i_mode:
            self.solver.remove_current_src(name = 'I_{}'.format(self.name))
            self.z_i_mode=0
        self.solver.remove_component(name ='R_'+self.name)   

    def get_Iv(self):
        ''' get the current through the voltage source when this port is stimulate'''
        IVname = 'I(V_{})'.format(self.name) 
        return self.solver.results[IVname]
    
    def eval_self(self):
        ''' This method is used to evaluate Zii when the voltage accross pnode and node is 1V'''
        I = complex(np.asarray(self.get_Iv()).item())# get the current throught the voltage source
        Z =  1 / I  # V = 1 V
        R = np.real(Z) * 1e3 # mOhm
        L = np.imag(Z)/self.s * 1e9 # nH
        return abs(R),abs(L)
    
    def eval_mutual(self,I):
        ''' This method is used to evaluatate Zij when there is a voltage accorss port j and this port current
        is set to 0 '''
        V1 = self.solver.results['V({})'.format(self.pnode)] 
        if self.nnode!= 0:
            V2 = self.solver.results['V({})'.format(self.nnode)]
        else:
            V2 = 0
        Z = (V1-V2)/I 
        m_R = np.real(Z) * 1e3 # mOhm - mutual resistance
        M = np.imag(Z)/self.s * 1e9 # nH - mutal inductance Mij == Mji
        return abs(m_R), abs(M)

class ImpedanceSolver(ModifiedNodalAnalysis):
    '''
    Default unit R: mOhm L: nH for rounding purpose
    One can rewrite this module to extract and convert Z to S to Y paramters
    '''
    def __init__(self):
        super().__init__()
        self.loops = {}
        self.imp_mat = None
        self.loop_index = 0
        self.map_loop_name_index = {}
    
    def add_loops(self,loops:list):
        '''
        add a list of loops and convert them to port.
        Each loop is a tuple/list of (name,src,sink)
        a port object will be created where p_pos = src and p_neg = sink
        '''
        for loop in loops:
            l_name,src,sink = loop
            self.loops[l_name] = [src,sink]
            self.map_loop_name_index[l_name] = self.loop_index # a counter for this loop in the impedance matrix
            self.loop_index+=1
    
    def run_analysis(self):
        '''
        Setup net-map, 
        '''
        self.graph_to_circuit_minimization()
        self.handle_branch_current_elements()  
        self.solve_MNA()  
        
        
               
    def init_impedance_matrix(self):
        num_loops = len(self.loops)
        self.imp_mat = np.zeros((num_loops,num_loops),dtype = np.complex128)
        
 
    def eval_impedance_matrix(self,freq = 1e9):
        '''
        This method create a list of Ports object from the loops element. 
        Then the method will find the self and mutual value and update the impedance matrix
        '''
        ports = []
        self.assign_freq(freq)
        print("start evaluation")
        t = time.perf_counter()
        for l_name in self.loops:
            src, sink =self.loops[l_name]
            index = self.map_loop_name_index[l_name]
            ports.append(Port(src,sink,index,self))
        num_ports = len(ports)
        for i in range(num_ports):
            #print("stimulate port {}".format(ports[i].index))
            p_ana = ports[i] # port with voltage stimulation
            p_ana.set_voltage()
            # set zero current for other ports
            z_ports = [ports[j] for j in range(num_ports) if i!=j]
            for p in z_ports:
                p.set_zero_current() 
            
            self.run_analysis()
            # evaluate this port self impedance
            Rii, Lii = p_ana.eval_self()
            Ivsrc = p_ana.get_Iv() 
            self.imp_mat[p_ana.index,p_ana.index] = Rii + Lii*1j
            for pz in z_ports:
                if self.imp_mat[p_ana.index,pz.index]==0: # if not updated
                   Rij, Lij = pz.eval_mutual(Ivsrc) # eval R_m and M 
                   self.imp_mat[p_ana.index,pz.index] = Rij + 1j*Lij
                   self.imp_mat[pz.index,p_ana.index] = Rij + 1j*Lij
                               
            # reset all ports (remove all current and voltage stimulation for next analysis)
            for k in range(num_ports):
                ports[k].reset_port() 
        print("total evaluation time", time.perf_counter() - t)   
     
    
    def map_self_idncutances_to_loop_name(self):
        """Map the loop inductances specified by the user to the matrix calcuation 

        Returns:
            _type_: _description_
        """
        l_name = list(self.loops.keys())
        res = {}
        for i in range(len(self.loops)):
            k = l_name[i]
            val = np.round(np.imag(self.imp_mat[i,i]),3)
            res[k] = val 
        return res
        

    def display_inductance_results(self):
        for row_id in (range(len(self.loops))):
            row_str = ""
            for col_id in (range(len(self.loops))):
                L =np.round(np.imag(self.imp_mat[row_id,col_id]),3)
                row_str+= " L{}{}: {}".format(row_id,col_id,L)
                row_str+= " "
            print(row_str)
             
    def graph_read_PEEC_Loop(self,msh_obj):
        # This is used to compared between loop and PEEC method
        for edge in msh_obj.PEEC_graph.edges(data=True):
            n1 = edge[0]
            n2 = edge[1]
            edata = edge[2]
            if edata['data'] !=None:
                Zdict = edata['Zdict']
            else:
                self.L_count += 1
                self.R_count += 1
                self.add_component("B_{0}{1}".format(n1,n2), n1, n2, 1e-6+1e-12j)
                continue
            for zkey in Zdict:
                self.L_count += 1
                self.R_count += 1
                branch_val = Zdict[zkey]
                self.add_component(zkey, n1, n2, branch_val)
            if n1 not in list(self.node_dict.keys()):
                self.node_dict[n1] = n1
            if n2 not in list(self.node_dict.keys()):
                self.node_dict[n2] = n2
        for k in msh_obj.M_PEEC:
            id1 = k[0]
            id2 = k[1]
            M_val = msh_obj.M_PEEC[k]
            L1_name = "Z{0}".format(id1)
            L2_name = "Z{0}".format(id2)
            M_name = 'M' + '_' + L1_name + '_' + L2_name
            self.add_mutual_term(M_name, L1_name, L2_name, M_val)
            self.M_count += 1

    def graph_read_loop(self,msh_obj):
        for edge in msh_obj.net_graph.edges(data= True):
            
            n1 = edge[0]
            n2 = edge[1]
            edata = edge[2]
            
            e_name = str(n1)+str(n2)
            R_val = abs(edata['res'])
            L_val = abs(edata['ind'])
            edata_data = edata['data']
            self.L_count+=1
            self.R_count+=1
            branch_val = 1j*L_val+R_val
            self.add_component("Z{0}".format(e_name), n1, n2, branch_val)
            p1 = msh_obj.net_2d_pos[n1]
            p2 = msh_obj.net_2d_pos[n2] 
            ori = edata_data['ori']
            self.node_dict[n1] = p1
            self.node_dict[n2] = p2
  
        # handle evaluated mutual pair
        for k in msh_obj.mutual_pair:
            e1 = k[0]
            e2 = k[1]
            M_val = msh_obj.mutual_pair[k][1] # Mval is same

            e1_name = str(e1[0]) + str(e1[1])
            e2_name = str(e2[0]) + str(e2[1])

            L1_name = "Z{0}".format(e1_name)
            L2_name = "Z{0}".format(e2_name)

            # at this point e1_name should be in the element list, if not the name is inverted
            if not L1_name in self.element:
                e1_name = str(e1[1]) + str(e1[0])
                L1_name = "Z{0}".format(e1_name)
            if not L2_name in self.element:
                e2_name = str(e2[1]) + str(e2[0])
                L2_name = "Z{0}".format(e2_name)
            
            M_name='M'+'_'+L1_name+'_'+L2_name
            self.add_mutual_term(M_name,L1_name,L2_name,M_val)
            
            self.M_count+=1

    def graph_read(self,graph):
        '''
        this will be used to read mesh graph and forming matrices
        :param lumped_graph: networkX graph from PowerSynth
        :return: update self.net_data
        '''

        for edge in graph.edges(data=True):
            n1 = edge[0]
            n2 = edge[1]
            edge_data = edge[2]['data']
            Rval = edge_data['res']
            Lval = edge_data['ind']
            branch_val = 1j*Lval+Rval
            self.add_z_component("Z{0}{1}".format(n1,n2), n1, n2, branch_val)

    def m_graph_read(self,m_graph,debug =False):
        '''

        Args:
            m_graph: is the mutual coupling info from mesh

        Returns:
            update M elemts
        '''
        if debug ==True:
            all_vals = []
            for edge in m_graph.edges(data=True):
                M_val = edge[2]['attr']['Mval']
                #if not M_val in all_vals:
                all_vals.append(M_val)
            all_vals.sort()
            plt.bar(np.arange(len(all_vals)),all_vals,align='center', alpha=0.5)
            plt.show()
        else:
            for edge in m_graph.edges(data=True):
                M_val = edge[2]['attr']['Mval']
                L1_name = 'Z' + str(edge[0])
                L2_name = 'Z' + str(edge[1])
                M_name='M'+'_'+L1_name+'_'+L2_name
                self.add_mutual_term(M_name,L1_name,L2_name,M_val)
                self.M_count+=1
