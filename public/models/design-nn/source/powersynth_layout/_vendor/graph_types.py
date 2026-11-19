# SPDX-License-Identifier: GPL-3.0-only
# Extracted from e3da/PowerSynth2-core, commit 88af2fff2467f2e01db1d0ffc6c8c420968d65fc.
# See THIRD_PARTY.md for provenance and modifications.


class Edge():
    """
    Edge class for CG:
    
    """
    def __init__(self, source=None, dest=None, constraint=0, index=0, type='non-fixed', weight=0,comp_type=None):
        self.source = source # source vertex
        self.dest = dest # destination vertex
        self.constraint = constraint # constraint value
        self.index = index # constraint name index in the constraint name list
        self.type = type # type of edge: three options: fixed, non-fixed, propagated 
        self.weight = weight # weight of the edge for randomization
        self.comp_type = comp_type #comp_cluster_types={'Flexible_Dim','Fixed_Dim'}
        self.setEdgeDict()

    def getConstraint(self):
        return self.constraint

    def setEdgeDict(self):
        self.edgeDict = {(self.source, self.dest): [self.constraint, self.type, self.index, self.weight, self.comp_type]}
        # self.edgeDict = {(self.source, self.dest): self.constraint.constraintval}

    def getEdgeDict(self,constraint_only=False):
        try:
            if constraint_only==False:
                self.edgeDict = {(self.source.index, self.dest.index): [self.constraint, self.type, self.index, self.comp_type]}
            else:
                self.edgeDict = {(self.source.index, self.dest.index): self.constraint}
        except:
            if constraint_only==False:
                self.edgeDict = {(self.source, self.dest): [self.constraint, self.type, self.index, self.comp_type]}

            else:
                self.edgeDict = {(self.source.index, self.dest.index): self.constraint}
        return self.edgeDict

    def getEdgeWeight(self, source, dest):
        return self.getEdgeDict()[(self.source, self.dest)]

    def printEdge(self):
        print("s: ", self.source.coordinate, "d: ", self.dest.coordinate, "con = ", self.constraint, "type:", self.type, "index:", self.index, "comp_type:", self.comp_type)

class Vertex():
    '''
    Vertex of a constraint graph
    '''
    def __init__(self, index=None, coordinate=None,incoming_edges=[], outgoing_edges=[],removable=False):

        self.index=index # index in ZDL_H/V
        self.coordinate= coordinate # x/y coordinate associated with the vertex
        self.incoming_edges=incoming_edges # list of incoming edges (Edge object) to the vertex
        self.outgoing_edges=outgoing_edges # list of outgoing edges (Edge object) to the vertex
        self.removable=removable # if it is a dependent or independent vertex.
        self.predecessors={} # dictionary of predecessor vertices as key and (constraint values, edge types) as value of a vertex
        self.successors={} # dictionary of successor vertices as key and (constraint values,edge types) as value of a vertex
        self.hier_type=[] #'background'/'foreground' type
        self.associated_type=[] # associated tile type list
        self.propagated=False # some vertices will be propagated from child node
        self.min_loc=0 # min location of a vertex 
        
    
    def printVertex(self):

        print("Index:", self.index)
        print("Coordinate:", self.coordinate)
        print("Propagated:", self.propagated)
        if self.removable ==True:
            print("Removable")
        else:
            print("Not Removable")

    def get_predecessors(self):
        '''
        function to get all predecessors of current vertex
        '''
        if len(self.incoming_edges)>0:
            for edge in self.incoming_edges:
                if edge.source not in self.predecessors:
                    self.predecessors[edge.source]=[edge.constraint,edge.type]
                else:    
                    self.predecessors[edge.source].append([edge.constraint,edge.type])
        
    def get_successors(self):
        '''
        function to get all successors of current vertex
        '''
        if len(self.outgoing_edges)>0:
            for edge in self.outgoing_edges:
                if edge.dest not in self.successors:
                    self.successors[edge.dest]=[edge.constraint,edge.type]
                else:    
                    self.successors[edge.dest].append([edge.constraint,edge.type])
